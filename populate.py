"""Fetch PubMed articles by topic, embed them, and upsert into Pinecone."""

import argparse
import os
import warnings

from dotenv import load_dotenv
from Bio import Entrez
from pinecone import Pinecone, ServerlessSpec
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

load_dotenv()

PINECONE_INDEX = "pubmed-articles"
EMBED_MODEL = "all-MiniLM-L6-v2"
EMBED_DIMS = 384
ABSTRACT_MAX_CHARS = 8000
FETCH_BATCH = 200
EMBED_BATCH = 100
UPSERT_BATCH = 100


def parse_article(article):
    """Extract metadata from a Biopython PubmedArticle dict. Returns None if no abstract."""
    try:
        citation = article["MedlineCitation"]
        art = citation["Article"]
    except (KeyError, TypeError):
        return None

    # Abstract is required
    try:
        abstract_parts = art["Abstract"]["AbstractText"]
        abstract = " ".join(str(part) for part in abstract_parts)
    except (KeyError, TypeError):
        return None

    if not abstract.strip():
        return None

    pmid = str(citation.get("PMID", ""))
    title = str(art.get("ArticleTitle", ""))

    # Authors
    authors = ""
    try:
        author_list = art["AuthorList"]
        names = []
        for a in author_list:
            last = a.get("LastName", "")
            initials = a.get("Initials", "")
            if last:
                names.append(f"{last}, {initials}" if initials else last)
        authors = ", ".join(names)
    except (KeyError, TypeError):
        pass

    # Journal
    journal = ""
    try:
        journal = str(art["Journal"]["Title"])
    except (KeyError, TypeError):
        pass

    # Pub date
    pub_date = ""
    try:
        pd = art["Journal"]["JournalIssue"]["PubDate"]
        parts = [str(pd.get("Year", "")), str(pd.get("Month", "")), str(pd.get("Day", ""))]
        pub_date = " ".join(p for p in parts if p)
    except (KeyError, TypeError):
        pass

    # DOI
    doi = ""
    try:
        for eid in art["ELocationID"]:
            if eid.attributes.get("EIdType") == "doi":
                doi = str(eid)
                break
    except (KeyError, TypeError, AttributeError):
        pass

    # MeSH terms
    mesh_terms = ""
    try:
        mesh_terms = ", ".join(str(h["DescriptorName"]) for h in citation["MeshHeadingList"])
    except (KeyError, TypeError):
        pass

    # Article type
    article_type = ""
    try:
        article_type = str(art["PublicationTypeList"][0])
    except (KeyError, TypeError, IndexError):
        pass

    abstract = abstract[:ABSTRACT_MAX_CHARS]

    return {
        "pmid": pmid,
        "title": title,
        "abstract": abstract,
        "authors": authors,
        "journal": journal,
        "pub_date": pub_date,
        "doi": doi,
        "mesh_terms": mesh_terms,
        "article_type": article_type,
    }


def fetch_pmids(topic, count):
    """Search PubMed and return list of PMIDs."""
    handle = Entrez.esearch(db="pubmed", term=topic, retmax=count)
    results = Entrez.read(handle)
    handle.close()
    pmids = results.get("IdList", [])
    actual = len(pmids)
    if actual < count:
        print(f"PubMed returned {actual} results (requested {count})")
    return pmids


def fetch_articles(pmids):
    """Fetch and parse articles in batches. Returns list of parsed metadata dicts."""
    articles = []
    for i in range(0, len(pmids), FETCH_BATCH):
        batch_ids = pmids[i : i + FETCH_BATCH]
        try:
            handle = Entrez.efetch(db="pubmed", id=batch_ids, rettype="xml")
            records = Entrez.read(handle)
            handle.close()
            for record in records.get("PubmedArticle", []):
                parsed = parse_article(record)
                if parsed:
                    articles.append(parsed)
        except Exception as e:
            warnings.warn(f"Failed to fetch/parse batch starting at index {i}: {e}")
    return articles


def upsert_vectors(index, embedded):
    """Upsert embedded articles into Pinecone in batches."""
    total = 0
    for i in range(0, len(embedded), UPSERT_BATCH):
        batch = embedded[i : i + UPSERT_BATCH]
        vectors = []
        for meta, embedding in batch:
            vectors.append({
                "id": meta["pmid"],
                "values": embedding,
                "metadata": meta,
            })
        index.upsert(vectors=vectors)
        total += len(vectors)
    return total


def main():
    parser = argparse.ArgumentParser(description="Populate Pinecone with PubMed article embeddings")
    parser.add_argument("--topic", required=True, help="PubMed search query")
    parser.add_argument("--count", required=True, type=int, help="Number of articles to fetch")
    args = parser.parse_args()

    # Init
    Entrez.email = os.environ.get("ENTREZ_EMAIL", "surprise-tree@example.com")
    embed_model = SentenceTransformer(EMBED_MODEL)
    pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])

    # Create index if needed
    existing = [idx.name for idx in pc.list_indexes()]
    if PINECONE_INDEX not in existing:
        pc.create_index(
            name=PINECONE_INDEX,
            dimension=EMBED_DIMS,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        print(f"Created Pinecone index '{PINECONE_INDEX}'")

    index = pc.Index(PINECONE_INDEX)

    # Fetch
    print(f"Searching PubMed for '{args.topic}'...")
    pmids = fetch_pmids(args.topic, args.count)
    print(f"Fetching {len(pmids)} articles...")
    articles = fetch_articles(pmids)

    total_fetched = len(pmids)
    total_skipped = total_fetched - len(articles)
    print(f"Parsed {len(articles)} articles ({total_skipped} skipped — no abstract or parse error)")

    if not articles:
        print("No articles to embed. Done.")
        return

    # Embed + upsert with progress
    print("Embedding and upserting...")
    embedded = []
    for i in tqdm(range(0, len(articles), EMBED_BATCH), desc="Embedding"):
        batch = articles[i : i + EMBED_BATCH]
        texts = [f"{a['title']}. {a['abstract']}" for a in batch]
        try:
            embeddings = embed_model.encode(texts).tolist()
            for art, emb in zip(batch, embeddings):
                embedded.append((art, emb))
        except Exception as e:
            warnings.warn(f"Embedding batch at index {i} failed: {e}")

    total_embedded = len(embedded)
    total_upserted = upsert_vectors(index, embedded)

    print(f"\nDone!")
    print(f"  Fetched:   {total_fetched}")
    print(f"  Skipped:   {total_skipped}")
    print(f"  Embedded:  {total_embedded}")
    print(f"  Upserted:  {total_upserted}")


if __name__ == "__main__":
    main()
