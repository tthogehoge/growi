sudo chown -R vscode:vscode /workspace;

# Instal additional packages
sudo apt update
sudo apt-get install -y --no-install-recommends \
  chromium locales fonts-ipafont fonts-ipaexfont fonts-ipafont-gothic fonts-ipafont-mincho
sudo apt-get clean -y

echo "ja_JP UTF-8" > /etc/locale.gen && locale-gen
export LANG=ja_JP.UTF-8

# Setup pnpm
SHELL=bash pnpm setup
eval "$(cat /home/vscode/.bashrc)"

# Install turbo
pnpm install turbo --global

# Install dependencies
turbo run bootstrap
