# Real Paper Audit (2026-09-09)

## Sources

Downloaded from public university repository records, not generated examples:

1. Powell et al. (2017), *Using routinely recorded data in the UK to assess
   outcomes in a randomised controlled trial: The Trials of Access*.
   [Liverpool repository](https://livrepository.liverpool.ac.uk/3010718/).
   Main manuscript: `liverpool-trials.docx`; separately published Table 1:
   `liverpool-table1.docx`.
   [Manuscript download](https://livrepository.liverpool.ac.uk/3010718/1/Trials%20and%20Tribulations%20Feasibility%20Paper%20Ver%203.4.docx).
   [Table download](https://livrepository.liverpool.ac.uk/3010718/2/Table%201.docx).
2. Burkitt and Watling (2025), *How children draw, write and tell about portraying
   mixed emotions in themselves and others children*.
   [Chichester repository](https://eprints.chi.ac.uk/id/eprint/7683/).
   Accepted manuscript: `chichester-emotions.docx`.
   [Download](https://eprints.chi.ac.uk/7683/7/IJADE%20accepted%20manuscript%20July2024.docx).
   The repository labels this accepted version CC BY-NC 4.0.

Files are retained locally under ignored `reports/real-papers/` for testing, not
redistributed with the repository. Original authors retain their rights. The
separate table is an attachment, not a third paper.

## Reproduction

Place downloaded files in a dedicated directory and run with a Python environment
containing `python-docx`:

```powershell
python -m tests.run_real_papers reports/real-papers
```

This opt-in command uses both bundled templates, writes first-pass and second-pass
output DOCX files, per-output reports and `audit.json` with input SHA-256 hashes. It overwrites only
the corresponding audit outputs. It does not download files or call a model.
Failed assertions produce a nonzero exit status. No matches for a reference
heading are recorded as null, not as evidence of successful identification.

## Findings and Verification

| Input | XML paragraphs | Tables | Hyperlinks | Drawings | Field markers | Numbering references |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Liverpool manuscript | 209 | 0 | 23 | 0 | 101 | 20 |
| Liverpool Table 1 | 23 | 1 | 0 | 0 | 27 | 0 |
| Chichester manuscript | 380 | 1 | 44 | 3 | 0 | 2 |

Initial testing found 20 numbering references removed from the Liverpool
manuscript. Body and reference-item numbering is now preserved. The legacy test
that required body list-style removal was replaced with preservation coverage.
Caption/table numbering cleanup retains its existing behavior.

Both English `References` headings were initially missed. Recognition now accepts
`References` and `Bibliography`, case-insensitively with an optional trailing
colon; regression tests cover the appendix boundary and numbered entries.

After the fixes, all six runs preserve paragraph text and checked XML structures,
media bytes, relationship targets, numbering definitions and footer contents.
Applied body line spacing and reference-heading identification also pass.
Equivalent XML serialization changes are compared canonically rather than as
raw bytes. Full Python regression: 112 tests passed.

## Expanded Audit

Four more files were downloaded and tested, bringing the corpus to seven files:

| Local file | Public source | Additional coverage |
| --- | --- | --- |
| `chinese-thesis-draft.docx` | [Public Chinese thesis draft](https://github.com/gcysmart123/my_work/blob/master/%E6%AF%95%E4%B8%9A%E8%AE%BA%E6%96%87%E5%88%9D%E7%A8%BF.docx) | GSM alarm-system draft; 99 XML paragraphs, 7 drawings, 58 numbering references |
| `liverpool-genome.docx` | [Liverpool record 3045242](https://livrepository.liverpool.ac.uk/3045242/) | Genome-wide association study; 891 XML paragraphs, 558 hyperlinks |
| `liverpool-genome-supplement.docx` | [Same record, supplementary note](https://livrepository.liverpool.ac.uk/3045242/3/PGC2_Bip_SuppNote_20180124.docx) | 575 XML paragraphs, 22 native equations, 8 drawings |
| `swansea-innocence.docx` | [Swansea record 40034](https://cronfa.swan.ac.uk/Record/cronfa40034) | Legal book chapter, 98 XML paragraphs, 41 footnote references |

These are five primary texts and two attachments, not seven independent papers.
The Chinese file is a public draft; publication or degree acceptance is not
verified. It is retained for local tests only and not redistributed.
Other attempted sources returned HTTP 401/403/404 and were not counted as tests.

The Chinese draft exposed a prose paragraph starting with a figure number being
mistaken for a caption, which cleared its numbering. Such prose is now handled
as body with a review warning. Bracketed Chinese abstract and keyword labels are
now recognized; tests verify that labels/content remain unchanged.

The auditor was reviewed too: it now includes footnotes/endnotes, all relationship
files, embedded objects, and media outside `word/media/`. Empty ZIP directory
entries are excluded. Absolute and relative internal relationship targets are
compared after resolving their package paths; actual target changes still fail.
Counterexample tests verify that changed links, footnotes and media are not hidden.

All 14 source/template combinations pass the structural and applicable format
checks. A second formatting pass of each output also produces unchanged document
XML and paragraph classifications: 28 executions total. Source hashes and full
results are in local `reports/real-papers/audit.json`. This is not a complete
semantic acceptance: the report separately flags missing title/heading detection.
Full Python regression after expansion: 118 tests passed.

## Recognition And Rendering Follow-up

Long first-paragraph titles now accept explicit bold typography (up to 240
characters), while ordinary long prose remains body. Named English main sections
and selected subsections are recognized even with Normal styles. Structured
abstract labels remain abstract content, while a main Results section after an
unstructured abstract exits the abstract. Short bold English numbered headings
are recognized without changing plain numbered lists into headings.

Regression: 123 Python tests pass, including five new tests for title/section
boundaries and document-grid interaction. API integration tests also pass.
All seven sources under both templates still pass applicable structural checks
and second-pass stability checks (28 formatting executions).

The missing renderer is resolved locally. The official LibreOffice 26.8.0 MSI
was downloaded, its Authenticode signature verified as Valid (The Document
Foundation), and administratively extracted into ignored `reports/render-tools/`.
It was not installed system-wide. The bundled renderer uses this task-local
executable and bundled Poppler. A process-local Python PATH assignment is needed
because the runtime launcher replaces shell PATH additions.

Reproduce rendering with the bundled Python runtime:

```powershell
python -m tests.render_real_papers <output.docx> --renderer <skill/render_docx.py> --soffice-dir reports/render-tools/libreoffice/program --poppler-dir <runtime/poppler/Library/bin> --output-dir reports/visual-qa-new
python -m tests.inspect_rendered_papers reports/visual-qa-new
```

Use a fresh output directory for each revision. Neither command grants visual
approval: the second produces overview sheets and page-boundary diagnostics.

Visual inspection exposed a genuine formatting conflict: source `snapToGrid`
overrode explicit template line spacing. Formatted paragraphs now disable grid
snapping without deleting the source section grid or altering protected content.
The Chinese draft changed from 16 pages to 12 after this correction.

The post-fix default-template visual sample contains the Chinese draft (12
pages), clinical manuscript (30 pages), and table attachment (1 page). All 43
page overviews were reviewed; selected first/table pages were also inspected at
full render size. No text characters extend beyond paper bounds in the PDF
coordinate check. This does not prove absence of subtle overlap, validate every
glyph at full size, or validate the other four sources or course-paper renders.
The table attachment remains one readable page. Chinese diagrams render, but
the large hardware diagram and its preceding heading are split across pages
4 and 5. The clinical manuscript contains two trailing pages with only footers.
These are open layout findings, not passing visual acceptance.
Both source files were also rendered (Chinese: 10 pages; clinical: 17 pages).
The original Chinese pages 3/4 already separate the heading and large diagram;
the original clinical pages 16/17 already contain only footers. These findings
are retained source defects, not newly introduced regressions. No automatic
deletion of source breaks or shrinking of scientific diagrams was performed.

## V2.7 Follow-up (2026-09-09)

The earlier counts and limitations above describe the earlier checkpoint.
The current corpus has 10 DOCX files (8 primary texts and 2 attachments), including
4 Chinese drafts. Three new sources are pinned in `chinese_paper_sources.json`;
run `fetch_chinese_papers.ps1` with PowerShell 7 to fetch or verify them.
Their public availability does not establish publication or academic acceptance.

Title-after-cover and implicit Chinese numbering now have targeted handling.
Current validation: 130 Python tests, 50 labeled recognition checks, 20 real
source/template combinations with second passes. Both template outputs received
full page-overview screening; visual acceptance still has failures. See
[V2.7 review](V27_REVIEW.md) for final page counts, replacement render directories,
source-versus-output findings and remaining risks. Do not reuse the 43-page
checkpoint as the current review coverage.

## Earlier Checkpoint Limits

This is not full visual or semantic acceptance. Implicit Chinese list-numbered
section headings and titles behind repository cover pages still need semantic
handling. Successful content preservation does not imply correct formatting of
every section. Multi-page figures and manual page breaks need a separate,
explicit layout policy rather than unconditional removal or image resizing.
The sample
does not establish conformity to any university's full Chinese thesis standard.
The expanded corpus includes one Chinese draft, not a representative population.
PDF-to-DOCX conversion was not used.
