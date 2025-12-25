# Makefile for Code Agent & GUI

.PHONY: clean build run all

# Paths
AGENT_DIR := code-agent
GUI_DIR := code-agent-gui

all: clean build run

clean:
	@echo "Cleaning code-agent..."
	rm -rf $(AGENT_DIR)/dist
	@echo "Cleaning code-agent-gui..."
	rm -rf $(GUI_DIR)/dist
	rm -f $(GUI_DIR)/tsconfig.electron.tsbuildinfo

build: build-agent build-gui

build-agent:
	@echo "Building code-agent..."
	cd $(AGENT_DIR) && npx tsc --noEmit && npx tsc

build-gui:
	@echo "Building code-agent-gui (Main & Renderer)..."
	cd $(GUI_DIR) && npm run build:main
	cd $(GUI_DIR) && npm run build:renderer

run:
	@echo "Starting Code Agent GUI..."
	cd $(GUI_DIR) && npm start

test:
	@echo "Running tests..."
	cd $(AGENT_DIR) && npx vitest run

