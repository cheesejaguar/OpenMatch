# OpenMatch Accessibility Statement

> Not legal advice. OpenMatch is committed to making the Service accessible to everyone. This statement describes our conformance target, the current status, and how to reach us about inaccessible content.

**Last updated:** 2026-05-13

## Conformance target

OpenMatch targets **WCAG 2.2 Level AA** for both the iOS app and any web-facing surface. For European Union users, we also intend to conform to **EN 301 549** in fulfilment of the **European Accessibility Act** (Directive (EU) 2019/882), which applies from **28 June 2025**.

## Current status

| Surface | Target | Current status |
|---|---|---|
| iOS app | WCAG 2.2 AA via Apple HIG, VoiceOver, Dynamic Type, Reduce Motion, Smart Invert | In progress; not yet audited externally. |
| Web (privacy / safety / transparency pages) | WCAG 2.2 AA | In progress; not yet audited externally. |
| Admin dashboard | WCAG 2.2 AA | Out of scope for end-user accessibility; internal use only. |

A third-party WCAG 2.2 AA audit is scheduled before public launch.

## Design choices that support accessibility

- **Icons and labels on every action.** We never rely on colour alone (privacy principle in [`docs/product/openmatch-design.md`](../product/openmatch-design.md) §7.3).
- **Dynamic Type** support throughout the iOS app.
- **Reduce Motion** honoured — swipe-card physics fall back to a fade.
- **VoiceOver** labels for every interactive element, including photo gallery navigation.
- **High contrast** colour pairings checked against WCAG contrast ratios.
- **No autoplaying** audio or video.
- **Keyboard / Switch Control** support on supported iOS surfaces.

## What we know is incomplete

- Audit of focus order in some modal flows.
- Caption support for any in-app onboarding video (none currently shipped).
- Web property accessibility audit (pending).

## Reaching us about accessibility

If you find an accessibility problem, please tell us:

- **Email:** accessibility@openmatch.app
- **Mail:** [Legal entity address]
- We aim to respond within **5 business days** and resolve substantive issues within **30 days** or provide an accessible alternative.

## Enforcement

If you are unable to resolve a complaint with us, you may contact:

- **US:** the U.S. Department of Justice, ADA Information Line ([ada.gov](https://www.ada.gov/)).
- **UK:** the Equality Advisory and Support Service.
- **EU:** the national authority responsible for the European Accessibility Act in your country.

## Review

This statement is reviewed at least annually and on any material change to the Service.
