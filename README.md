# Diogo Pires — Portfolio

Personal portfolio site for Diogo Pires, Software Engineering student and
full-stack developer. Built with [Astro](https://astro.build) and deployed
on GitHub Pages at [diogopires2003.github.io](https://diogopires2003.github.io).

## Features

- **Editorial/Swiss-inspired design** — numbered index sections, hairline
  grid layout, Archivo + JetBrains Mono typography, ink/paper/accent palette
- **Light & dark themes** — manual toggle, persisted per visitor, no flash
  on load
- **Command palette** (`⌘K` / `Ctrl+K`) — jump to any page or action by
  typing
- **Client-side page transitions** via Astro's `ClientRouter`
- **Live GitHub data** — the home page pulls your most recently updated
  public repo straight from the GitHub API
- **Sortable, filterable skills table** with animated proficiency bars
- Scroll progress indicator, animated stat counters, and a copy-to-clipboard
  email on the contact page

## Project structure

```text
/
├── public/
│   ├── favicon.svg / favicon.ico   # Site favicon
│   └── og-image.jpg                # Social share preview image
├── src/
│   ├── assets/
│   │   └── profile.jpg             # Profile photo (processed by Astro's Image component)
│   ├── layouts/
│   │   └── Layout.astro            # Shared header, footer, theme toggle, command palette
│   └── pages/
│       ├── index.astro             # Home — hero, about, highlights, tech stack
│       ├── skills.astro            # Technical stack table
│       ├── academic.astro          # Education & certifications timeline
│       └── contact.astro           # Contact links
└── astro.config.mjs
```

Each file in `src/pages/` is a route based on its file name (Astro's
file-based routing).

## Commands

All commands run from the project root:

| Command             | Action                                       |
| :------------------- | :-------------------------------------------- |
| `npm install`         | Install dependencies                          |
| `npm run dev`          | Start the local dev server at `localhost:4321` |
| `npm run build`        | Build the production site to `./dist/`        |
| `npm run preview`      | Preview the production build locally          |
| `npm run astro ...`    | Run Astro CLI commands (e.g. `astro check`)   |

## Deployment

Pushing to `main` triggers the `Deploy to GitHub Pages` GitHub Actions
workflow (`.github/workflows/`), which builds the site with Astro and
publishes `./dist` to GitHub Pages automatically.
