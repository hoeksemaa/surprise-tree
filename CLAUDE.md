In this repo, there are only two types of files: code files (scripts, servers, frontends, markdown files, etc) and design docs.
Design docs are a combination of WHAT to build: design and HOW to build it: implementation details. 
They should represent an accurate compression of the code: contain all of the design choices, reasons for design choices, technical stack, and additional clarifying information to fully implement the software from the design doc.
Similarly, reading the design doc should basically fully explain the code files the design doc covers.
Each design doc should contain a list of files it applies to and a short one sentence description of what each file does.
Each design doc name should be descriptive enough to identify the feature it covers at a glance—err on the side of lengthy, specific names over short generic ones, so that scanning a list of design docs immediately reveals which feature each one addresses.
There should be a strict one-to-one correlation between features and design docs: one new feature = one new design doc.
Every code file in the repo must be referenced in at least one design doc.
The design doc is canonical: any difference between the code and the design doc means at least one of them must change. Design docs must have a concrete code implementation plan.

# Project Context
This is NOT production-grade software. It's a ~4 hour spearfish project intended to impress the CEO of a small startup. Optimize for speed of development and impressiveness, not robustness or scale.
