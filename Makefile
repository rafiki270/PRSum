.DEFAULT_GOAL := help

APP_NAME ?= PRSum
PROJECT_DIR ?= build/PRSum-Safari
BUNDLE_ID ?= com.rafiki270.PRSum

.PHONY: help safari safari-open safari-clean chrome chrome-pack

help:
	@echo "PRSum make targets:"
	@echo "  make safari        - Convert WebExtension to Safari Xcode project"
	@echo "  make safari-open   - Open the generated Xcode project"
	@echo "  make safari-clean  - Remove the generated Xcode project"
	@echo "  make chrome        - Build Chrome MV3 unpacked folder in dist/chrome"
	@echo "  make chrome-pack   - Zip Chrome folder to dist/prsum-chrome.zip"
	@echo ""
	@echo "Variables (override with VAR=value):"
	@echo "  APP_NAME=$(APP_NAME)  PROJECT_DIR=$(PROJECT_DIR)  BUNDLE_ID=$(BUNDLE_ID)"

safari:
	@mkdir -p "$(PROJECT_DIR)"
	@echo "Generating Safari project at $(PROJECT_DIR) with bundle id $(BUNDLE_ID) ..."
	@xcrun safari-web-extension-converter . \
		--project-location "$(PROJECT_DIR)" \
		--app-name "$(APP_NAME)" \
		--bundle-identifier "$(BUNDLE_ID)" \
		--macos-only \
		--no-open \
		--force
	@echo "Done. Open with: make safari-open"

safari-open:
	@open "$(PROJECT_DIR)/$(APP_NAME)/$(APP_NAME).xcodeproj"

safari-clean:
	@echo "Removing $(PROJECT_DIR) ..."
	@rm -rf "$(PROJECT_DIR)"
	@echo "Done."

CHROME_DIST := dist/chrome

chrome:
	@mkdir -p "$(CHROME_DIST)"
	@echo "Preparing Chrome MV3 unpacked extension at $(CHROME_DIST) ..."
	@cp -f manifest.chrome.json "$(CHROME_DIST)/manifest.json"
	@cp -f background.js content-script.js popup.js popup.html popup.css options.html options.js "$(CHROME_DIST)/"
	@if [ -d icons ]; then cp -R icons "$(CHROME_DIST)/"; fi
	@echo "Load unpacked via chrome://extensions → Developer Mode → Load unpacked → $(CHROME_DIST)"

chrome-pack: chrome
	@mkdir -p dist
	@cd dist && zip -qr "prsum-chrome.zip" "chrome"
	@echo "Packed: dist/prsum-chrome.zip"
