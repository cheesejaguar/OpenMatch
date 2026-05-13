# Children & Minor Users Policy

> Not legal advice. OpenMatch is **18+ only**, enforced at the code level. This policy covers what we do when an underage user is identified despite the age gate, and how the design satisfies COPPA, the CA AADC, the UK Children's Code, and the dating-app-relevant parts of state age-verification statutes.

## 1. Rule

**OpenMatch is for adults aged 18 or older.** No exceptions. There is no minor mode. There is no parental-consent path. We do not offer the Service to anyone under 18.

## 2. Age assurance

We apply layered age assurance:

1. **Date-of-birth check at signup.** Users enter their DOB, not a "I am 18+" checkbox. Future age changes are not permitted in the app.
2. **Apple Declared Age Range** (iOS 18.4+). When available, the system signal is used to confirm the user is in the 18+ band before account creation.
3. **Behavioural signal escalation.** Photo classifier, content patterns, peer reports, or reported age trigger a re-prompt for stronger verification.
4. **Document / biometric verification.** Used only on escalation, only with a privacy-minimising vendor (one-way result token; no retained PII; BIPA-safe for Illinois users; explicit consent).

## 3. Actual-knowledge handling

If we obtain **actual knowledge** that an account belongs to someone under 18 (report, in-app message, regulator notice, court order):

1. The account is **suspended immediately**.
2. Profile, photos, swipes, likes, and messages are removed from discovery and from the surviving party's view in chats.
3. The data is **deleted** within 30 days, retaining only the minimum required for fraud / law-enforcement purposes (hashed ban-evasion signal + safety record).
4. If the user appears to be under 13, the record is processed under COPPA: no further collection, immediate deletion, and (if facts warrant) NCMEC report.
5. We log the chain of evidence and the action taken, retained for 6 years.

## 4. CSAM and child safety reporting

We are a "provider of an electronic communication service" under 18 USC 2258A. We will:

- Report apparent **child sexual abuse material (CSAM)** to the **NCMEC CyberTipline** in the time and form required by law.
- Preserve the content for **90 days** (or longer on extension request) per 18 USC 2258A(h).
- Cooperate with lawful process from law-enforcement agencies investigating offences against children.
- Apply known-CSAM hash matching (PhotoDNA, NCMEC industry hash sharing) to incoming photos and on report.

## 5. Specific framework alignment

| Framework | What it asks | How we comply |
|---|---|---|
| **COPPA (US, under 13)** | No collection without verifiable parental consent. | We do not allow under-13 accounts at all. On actual knowledge, immediate deletion and (where facts warrant) NCMEC report. |
| **California AADC (AB 2273)** | Privacy- and safety-protective defaults for services "likely to be accessed by children". | We are not designed to be accessed by children — DOB gate, 17+ App Store rating, marketing to adults only. We still apply data-minimisation by default. (Track injunction status.) |
| **UK Children's Code** | High-confidence age assurance for any service where minors might end up. | Layered assurance as in §2; ICO-aligned. |
| **EU DSA Art. 28** | Protection of minors design duty. | Same. |
| **State age-verification laws (TX SCOPE, UT, MS, LA, AR, OH, TN, FL, NY SAFE)** | Various — most aimed at services permitting minors. | Our compliance path is "robust adult-only assurance," not "minor mode UX." Track each statute for adult-platform applicability. |
| **TAKE IT DOWN Act (US, 2025)** | 48-hour NCII takedown; covers AI-generated. | Dedicated reporting form (in-app and web), 48-hour SLA, no requirement to re-upload the image. |

## 6. Reporting an under-age user

Anyone — user or non-user — can report a suspected under-age account by:

- **In-app:** Report → reason "Under-age".
- **Email:** safety@openmatch.app, subject "Underage account".
- **Web form:** [`/safety/report-underage`].

Reports are reviewed within 24 hours.

## 7. Internal review

This policy is reviewed annually and on any material change in age-assurance law or our age-assurance vendors.
