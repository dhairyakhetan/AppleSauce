# Shikshaq

A platform to find quality tuition teachers in Kolkata. Pick your subject, grade and location. Read real student reviews. Reach out directly.

> ## Read this before you push
>
> **This folder pushes to TWO GitHub repositories.** They are not forks and
> they must never hold different code.
>
> | remote | repository | what it is |
> |---|---|---|
> | `origin` | `kushalsethia/Shikshaq` | **LIVE.** Real users. Source of truth. |
> | `kanitest` | `kaxx4/shikshaqkanitest` | **TEST.** Vercel preview deploy. |
>
> Commit once, then `npm run push:all` sends the same commit to both.
> A fresh clone only has `origin` - run `npm run remotes:setup` to add the other.
>
> The test site differs from the live site **only by environment variables**,
> never by different code. Do not branch them apart: two repos with different
> code is two codebases, and every change would have to be merged twice.
>
> Both deployments share **one live Supabase project**, so anything the test
> site writes is written to production.
>
> Full working rules, standing constraints and gotchas: **[CLAUDE.md](CLAUDE.md)**.

## Getting Started

### Prerequisites

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

### Installation

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

## Development

### Edit a file directly in GitHub

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

### Use GitHub Codespaces

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## Technologies

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Supabase

## Deployment

Build the project for production:

```sh
npm run build
```

The built files will be in the `dist` directory, ready to be deployed to your hosting provider of choice.
