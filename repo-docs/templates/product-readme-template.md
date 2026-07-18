---
name: "product-readme-template"
description: "README template for end-user products, tools, applications, or platforms. Focuses on the user journey, deployment, and usage rather than source code compilation."
---

# {Product Name}

> {One-line pitch: What it is and the primary problem it solves.}

<!-- Optional: Badges for version, license, status, discord -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

{2–3 sentences explaining what the product does, who it's for, and why they should care. Focus on the value delivered, not the tech stack.}

---

## Typical Use Cases

- **{Use Case 1}**: {Describe a specific real-world scenario where a user would apply this product to solve a problem.}
- **{Use Case 2}**: {e.g., "Onboarding: New engineers query the knowledge base instead of reading thousands of commits."}

---

## Getting Started

### Prerequisites
- {e.g., Docker, Node.js, specific OS requirements}
- {Any required API keys or external accounts}

### Installation / Deployment
```bash
# E.g., Docker run command, or download link instructions
docker run -d -p 8080:8080 my-product/latest
```

### Initial Configuration
{1-2 steps to configure the bare minimum to get it running, e.g., setting up the `.env` file or initial login.}

---

## Core Workflow & Features

{Walk the user through their first "Aha!" moment. How do they actually use the product?}

### 1. {Step One: e.g., Ingestion / Connection}
{Explanation and command/screenshot}

### 2. {Step Two: e.g., Processing / Analysis}
{Explanation and command/screenshot}

### 3. {Step Three: e.g., Querying / Results}
{Explanation and command/screenshot}

---

## Concepts & Glossary

| Term | Definition |
|---|---|
| `{Term 1}` | {Plain English explanation of specific product terminology} |
| `{Term 2}` | {Explanation} |

---

## Security & Privacy

{Critical for AI or data-heavy products. Explain where data goes, how keys are stored, and if any third-party telemetry or LLM training is involved.}

- **Data Locality:** {e.g., Everything runs locally, no code is sent to the cloud except via explicit LLM prompts.}
- **Credentials:** {e.g., API keys are stored encrypted in the local SQLite database.}

---

## FAQ & Limitations

- **Q: {Common question or error}**
  - **A:** {Solution or workaround}

- **Known Limitation:** {e.g., Currently only supports repositories under 2GB.}

---

## Support & Community

- Need help? Open an [Issue](https://github.com/...).
- Join our community on [Discord/Slack](#).

---

## For Developers

Want to build `{Product Name}` from source or contribute? 
Please see our [Contributing Guide](CONTRIBUTING.md) and the AI instructions in [`AGENTS.md`](AGENTS.md).
