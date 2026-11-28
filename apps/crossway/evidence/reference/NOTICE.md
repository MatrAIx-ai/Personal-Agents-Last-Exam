# Reference screenshots: notice

The images in this folder are screenshots of public web pages of E-ZPass New York
(https://www.e-zpassny.com) and Tolls by Mail New York (https://tollsbymailny.com, which
redirects to the shared e-zpassny.com site). One image (`mta-tolls-archive.png`) is a
web.archive.org (Wayback Machine) capture of the public MTA Bridges and Tunnels toll page
that the E-ZPass NY "Toll Rates" menu links to; it is labelled as an archive capture.

- The page content, logos and images belong to their respective owners (E-ZPass New York,
  Tolls by Mail New York and their operators, and the MTA for the archive capture).
- They are included only as review comparison evidence for the Crossway App's workflows
  (paying and disputing a toll bill or violation, vehicles and plates, prepaid balance
  replenishment, tag management, toll rates).
- They are NOT covered by the package license (MIT / CC0) and are NOT used as runtime
  assets of the App.
- Captured on 2026-11-28 (UTC) with headless Playwright Chromium (default user agent,
  1280x800 viewport) by `capture-reference.cjs`.
- No sign-in, no form input or submission, no account creation and no personal data were
  involved. The only interactions were opening navigation menus by hover, switching FAQ
  categories, expanding FAQ answers and stepping the home page alert carousel. The sample
  toll invoice and "DAV 999" plate on `tbm-pay-toll.png` are the site's own published
  illustrations.

## Files

Per-file details (workflow, page title, final URL, requested URL, capture timestamp,
viewport, bytes, notes) and the list of blocked URLs are in `sources.json`.

| File | Workflow | Source URL |
| --- | --- | --- |
| tbm-pay-toll.png | pay_notice | https://www.e-zpassny.com/tbm/pay-toll |
| tbm-ways-to-pay.png | pay_notice | https://www.e-zpassny.com/tbm/ways-to-pay |
| tbm-faq-pay-toll-bill.png | pay_notice | https://www.e-zpassny.com/tbm/faq#payments |
| ezpass-faq-pay-violation.png | pay_notice | https://www.e-zpassny.com/faq#violations |
| tbm-faq-dispute-violation.png | dispute_notice | https://www.e-zpassny.com/tbm/faq#violations |
| tbm-faq-not-my-vehicle.png | dispute_notice | https://www.e-zpassny.com/tbm/faq#general-questions |
| ezpass-faq-dispute-violation.png | dispute_notice | https://www.e-zpassny.com/faq#violations |
| ezpass-faq-plates.png | vehicles_plates | https://www.e-zpassny.com/faq#vehicles-&-tags |
| ezpass-faq-update-account.png | vehicles_plates | https://www.e-zpassny.com/faq#account-updates |
| ezpass-faq-replenish.png | topup_replenish | https://www.e-zpassny.com/faq#payments |
| ezpass-home-rebill-alert.png | topup_replenish | https://www.e-zpassny.com/ |
| ezpass-faq-tags.png | transponder | https://www.e-zpassny.com/faq#vehicles-&-tags |
| ezpass-account-types.png | transponder | https://www.e-zpassny.com/ezpass/account-types |
| mta-tolls-archive.png | rates | https://web.archive.org/web/20261104030145/https://www.mta.info/fares-tolls/tolls (archive capture, snapshot 2026-11-04 03:01:45 UTC) |

All files were captured on 2026-11-28 (UTC). The live MTA page
https://www.mta.info/fares-tolls/tolls returned HTTP 403 "Access Denied" to headless
Chromium and was not captured directly (see `blocked` in `sources.json`).
