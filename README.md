This is the Daily Overview dashboard project.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Food & Drink Capacities Export

The Food & Drink section can read a local Capacities-style export from:

`data/food-drink.capacities.json`

How to use it:

1. Copy `data/food-drink.capacities.example.json`
2. Rename the copy to `data/food-drink.capacities.json`
3. Paste your exported Food & Drink objects into that file as a JSON array
4. Restart the app if it is already running

If that file is missing, empty, or cannot be read, the app safely falls back to the existing mock Food & Drink data.

The real `data/food-drink.capacities.json` file is ignored by git so you can keep it private on your machine.

## Food & Drink Import Workflow

When you want to update the local file from a fresh Capacities export or a pasted JSON dump:

1. Put the import JSON into `data/food-drink.capacities.import.json`
2. Run `npm run import:food-drink`
3. Refresh or restart the app
4. The importer merges the new items into `data/food-drink.capacities.json` and keeps existing structured specials when possible

You can use `data/food-drink.capacities.import.example.json` as the starting shape for a new import.

## Event Sources

Today&apos;s Events and Upcoming Events now try official venue sources first.

Current live venue sources:

1. White Oak Music Hall official site
2. Dan Electro&apos;s official upcoming events page
3. Continental Club Houston official page audit
4. Scout Bar official homepage

If official venue sources cannot be loaded, the dashboard safely falls back to mock event data.

## GitHub Pages Snapshot Mode

The dashboard can also render from a build-time JSON snapshot for future static hosting.

How to generate a snapshot:

```bash
npm run generate:snapshot
```

This writes `public/data/dashboard-snapshot.json`, which is ignored by git so it can stay a local build artifact.

How to preview snapshot mode locally:

```bash
DASHBOARD_DATA_MODE=snapshot npm run dev:clean
```

To generate the snapshot and then build in snapshot mode:

```bash
npm run build:static-prep
```

In snapshot mode, the dashboard reads the generated JSON instead of running live fetches during page render. The existing live local mode still works the same way as before.

## Music Taste Overrides

The music scorer can read a local override file from:

`data/music-taste.overrides.local.json`

How to use it:

1. Copy `data/music-taste.overrides.example.json`
2. Rename the copy to `data/music-taste.overrides.local.json`
3. Edit artist, title-pattern, or negative-match rules by hand
4. Refresh the app

If the local file is missing, the app falls back to the example file. If both are missing or unreadable, the app keeps running with no overrides.

The private local override file is ignored by git so you can keep it on your own machine.

## Notes

- No Ticketmaster API key is required for the current event provider setup.
- `.env.local` is still ignored by git because `.gitignore` includes `.env*`.
