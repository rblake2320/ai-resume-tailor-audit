# Personal-information protection boundary

Resume Foundry's **Protect** mode replaces detected values in the browser before
the tailoring request is sent, then restores those exact values in the returned
document. **Review** mode shows the detected categories before the user chooses
protected or exact transmission. **Exact** mode sends the text as entered.

The detector covers email addresses, LinkedIn `/in/{user}` profiles and root
GitHub/GitLab user profiles (not repository or group URLs), common US
street-address forms, dashed/spaced/compact US SSN-shaped identifiers, common
US phone forms, and `+`-prefixed international numbers containing 8–15 digits.
The user can also enter their own name explicitly; only that supplied value is
masked. The product does not guess personal names from arbitrary prose because
doing so is neither culturally complete nor reliably distinguishable from
employers, references, products, and places.

This is a data-minimization aid, not a general data-loss-prevention guarantee.
National phone and identifier formats vary, compact nine-digit values can be
ambiguous, addresses outside the covered forms may be missed, and text can
contain other sensitive facts. Generic portfolio and project URLs are not
guessed to be personal profiles; users should inspect them in Review mode or
remove them manually when needed. Review mode is the appropriate choice when the
user wants to inspect detections; Exact mode remains an explicit escape hatch.
No mode changes the underlying browser-local saved profile.

Protected placeholders use a fresh random namespace for each run. Restoration
prioritizes the tailored résumé before the cover letter and then uses stable
field ordering. It restores no more occurrences than existed in the submitted
source; an unexpected model-added repetition becomes an explicit
`Personal information withheld` marker instead of inserting extra PII or
leaking an internal placeholder.
