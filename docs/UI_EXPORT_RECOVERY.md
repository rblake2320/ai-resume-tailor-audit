# UI, export, and local recovery boundary

## Printing and document export

Print/PDF always uses a dedicated print document built from the current generated result. It does not print the surrounding controls. The print document remains available when the user is viewing ATS text or manually editing a resume or cover letter, so those modes cannot produce a blank printout.

DOCX export is single-column and uses ordinary Word headings, paragraphs, and bullets. The regression suite opens the generated ZIP package, reads `word/document.xml`, and confirms that every meaningful ATS-text line survives the export. This is a structural text round trip; it does not claim visual fidelity in every version of Word or acceptance by every third-party ATS.

## Corrupted browser storage

Profile, session, history, save-point, job-inbox, and application records are schema-validated on load. Malformed records are removed from the active key and copied byte-for-byte to a sibling `:quarantine` key where feasible. The app then opens with an empty safe fallback instead of repeatedly crashing on reload.

Quarantine is recovery evidence, not trusted application state. The **Erase all my data** action removes active and quarantined local records and deletes the encrypted career-ledger database.

## Accessibility and narrow screens

Generated documents expose standard tablist/tab/tabpanel semantics, roving tab focus, and Left/Right/Home/End keyboard navigation. Completion is announced through a polite status region. Connector controls may shrink or wrap at very narrow widths instead of imposing a fixed minimum width.
