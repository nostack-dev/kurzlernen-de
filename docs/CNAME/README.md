# CNAME File Guide

## What is this file?
The `CNAME` file is a single-line text file that tells GitHub Pages which custom domain should point to this repository. In our case it contains the domain `kurzlernen.de`, so GitHub knows to serve the site when someone types that address into their browser.

## Why it matters (from first principles)
Domain Name System (DNS) records map human-friendly names like `kurzlernen.de` to numeric IP addresses. GitHub Pages automatically hosts sites under `<username>.github.io`, but if we want to use our own domain we must register it and then prove to GitHub which domain belongs to this repository. The simplest proof is this `CNAME` declaration. When GitHub builds the site, it reads this file and configures its edge servers to respond to `kurzlernen.de` instead of the default address.

## Fun mental model
Think of the `CNAME` file as a VIP guest list. GitHub is the bouncer who only lets domains on the list access the private party (our website build). Without the `CNAME`, visitors would be directed to the generic entrance and our custom banner would never appear.

## Editing tips
- The file must contain only the domain name and nothing else—no protocol (`https://`) and no trailing spaces.
- If you ever change domains, update this file and adjust your DNS provider’s `CNAME` record to point to `<username>.github.io`.
- Deleting the file reverts the site back to the default GitHub Pages domain.

## Quick checklist
- [x] Custom domain registered with a DNS provider.
- [x] DNS provider has a `CNAME` record pointing to `kurzlernen.github.io` or similar.
- [x] This repository contains the matching `CNAME` file.

Keep this tiny file safe—without it the rest of the project would only shine on the default GitHub Pages address!
