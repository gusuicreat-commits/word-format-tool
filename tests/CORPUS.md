# Synthetic Paper Regression Corpus

Run `python -m unittest tests.test_document_corpus` from the repository root
using an interpreter with `python-docx` installed.

The tests generate documents in temporary directories, load real templates and
overrides, format the documents, and reopen the saved outputs. No private papers,
network access, or model calls are used. Temporary files are removed after each
test. `make_paper()` is the reusable representative fixture builder.

| Scenario | Assertions |
| --- | --- |
| Representative paper, both shipped templates | Text order, hyperlink targets, fields, bookmarks, image bytes/drawing XML, equations, numbering, merged cells and header/footer parts remain intact |
| Body override | Saved font size and line spacing match requested values |
| Bilingual abstracts and keywords | Independent sizes, label/content boldness and execution counts match output |
| References and appendix | Hanging indentation applies to references; appendix exits the reference section |
| TOC style and field | Original paragraph XML remains unchanged; report claims no applied style |
| Multi-paragraph TOC with nested PAGEREF | All TOC paragraphs preserved; following body receives formatting |
| Merged cell with nested table | Each physical table processed and reported once |
| Mixed run with tab/line break | Chinese size retained; unsafe Latin/digit splitting reported as skipped |
| Legacy abstract compatibility | Specific Chinese title inherits legacy defaults; old content rule remains effective |

Comparisons allow intended run/style changes while checking protected package
parts and structures. They do not guarantee identical pagination in Word/WPS.
Tracked changes, OLE objects, full footnote/endnote parts, floating images and all
section layouts are not covered. TOC XML preservation does not freeze inherited
styles or regenerate page numbers. Final pagination still needs visual review.
