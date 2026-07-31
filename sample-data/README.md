# Sample review data

Generated from the accepted publications in `data/azzurro-reviews.sqlite` on
31 July 2026.

Files:

- `sample-reviews.jsonl`
- `sample-reviews.csv`
- `export-manifest.json`

The sample contains 62 unique public review records:

- Olympic Paddington: 12
- Potts Point: 25
- Darling Harbour: 25
- Central Sydney: 0

Central is deliberately absent because no qualifying Central generation has
been published. The dashboard still lists it as Collecting.

The exporter replaces Booking's internal review token with a stable one-way
public ID and removes request/session data. No login credentials, cookies, API
keys, or browser profiles are included.
