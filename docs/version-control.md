# 🔄 GoWager - Version Control Guide

This guide explains how to use Git and GitHub for the GoWager project.

---

## 📋 What is Version Control?

Version control (Git) tracks every change to your code. It lets you:
- Save snapshots of your work
- Go back to previous versions
- Work on features without breaking the main code
- Collaborate with others

---

## 🚀 Getting Started

### 1. Install Git

**Windows**: Download from [git-scm.com](https://git-scm.com) and install.

**Check if installed**:
```bash
git --version
```

### 2. Configure Git (first time only)

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

### 3. Create a GitHub Account

1. Go to [github.com](https://github.com)
2. Click **Sign Up**
3. Follow the instructions

---

## 📁 Basic Git Commands

### Initialize a Repository
```bash
git init
```

### Check Status
```bash
git status
```

### Stage Files (add to commit)
```bash
# Add a specific file
git add backend/server.js

# Add all files
git add .
```

### Commit Changes
```bash
git commit -m "Description of changes"
```

### View Commit History
```bash
git log --oneline
```

### Push to GitHub
```bash
git push origin main
```

### Pull Latest Changes
```bash
git pull origin main
```

---

## 🔄 GoWager Workflow

### Initial Setup
```bash
# From the project folder
cd "c:\Users\ASL STUDIOS\Desktop\nb88"

# Initialize repository
git init

# Add all files
git add .

# First commit
git commit -m "Initial GoWager commit"

# Set main branch
git branch -M main

# Connect to GitHub
git remote add origin https://github.com/YOUR_USERNAME/gowager.git

# Push to GitHub
git push -u origin main
```

### Daily Workflow
```bash
# 1. Check what changed
git status

# 2. Add your changes
git add .

# 3. Commit with a message
git commit -m "Describe what you changed"

# 4. Push to GitHub
git push
```

### Good Commit Messages
```
✅ Good:
- "Add Rock Paper Scissors game logic"
- "Fix bug in payout calculation"
- "Update API URL for production"
- "Add wallet withdrawal feature"

❌ Bad:
- "Update stuff"
- "Fix"
- "Changes"
- "asdf"
```

---

## 🌿 Branching Strategy

### What are Branches?
Branches let you work on features without affecting the main code.

### Main Branch
- `main` - Always working, production-ready code

### Feature Branches
```bash
# Create a new branch
git checkout -b feature/add-new-game

# Make changes and commit
git add .
git commit -m "Add new game"

# Switch back to main
git checkout main

# Merge the feature
git merge feature/add-new-game

# Push to GitHub
git push
```

### Branch Naming
- `feature/...` - New features (e.g., `feature/add-tic-tac-toe`)
- `fix/...` - Bug fixes (e.g., `fix/payout-bug`)
- `docs/...` - Documentation (e.g., `docs/update-howto`)

---

## 🔧 Common Git Operations

### Undo Last Commit (keep changes)
```bash
git reset --soft HEAD~1
```

### Undo Last Commit (discard changes)
```bash
git reset --hard HEAD~1
```

### Discard Uncommitted Changes
```bash
git checkout -- filename
```

### Stash Changes (temporarily save)
```bash
# Save changes
git stash

# Restore changes
git stash pop
```

### View What Changed
```bash
git diff
```

### Clone a Repository
```bash
git clone https://github.com/YOUR_USERNAME/gowager.git
```

---

## 🚫 What NOT to Commit

Never commit these files:
- `.env` - Contains secrets
- `node_modules/` - Dependencies (reinstall with `npm install`)
- `.DS_Store` - macOS system files
- `*.log` - Log files

### .gitignore File

Create a `.gitignore` file in the project root:

```gitignore
# Dependencies
node_modules/

# Environment
.env

# Logs
*.log

# OS files
.DS_Store
Thumbs.db

# Editor files
.vscode/
.idea/
```

---

## 🔄 Deployment Workflow

### Automatic Deployments
- **Vercel**: Automatically deploys when you push to `main`
- **Render**: Automatically deploys when you push to `main`

### Workflow
1. Make changes locally
2. Test locally
3. Commit changes
4. Push to GitHub
5. Vercel/Render auto-deploy

---

## 🆘 Troubleshooting

### "Permission denied" when pushing
```bash
# Make sure you're authenticated
git config --global credential.helper store
# Then push again
git push
```

### "Failed to push some refs"
```bash
# Pull latest changes first
git pull origin main
# Then push
git push
```

### "Not a git repository"
```bash
# Initialize first
git init
```

### "Nothing to commit"
```bash
# You have no changes. Make some edits first.
```

---

## 📚 Resources

- [Git Documentation](https://git-scm.com/doc)
- [GitHub Guides](https://guides.github.com)
- [Git Cheat Sheet](https://education.github.com/git-cheat-sheet-education.pdf)

---

## 🎯 Best Practices

1. **Commit often** - Small, focused commits are easier to understand
2. **Write clear messages** - Describe what and why
3. **Pull before push** - Avoid conflicts
4. **Never commit secrets** - Use `.env` files
5. **Test before committing** - Make sure it works
6. **Use branches for big features** - Keep `main` stable
7. **Backup to GitHub** - Your code is safe in the cloud