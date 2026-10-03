APP ?= vorlage
ENTRY := src/apps/$(APP)/main.ts

.PHONY: all dev build clean check index

all: dev

check:
	@test -f "$(ENTRY)" || { echo "App '$(APP)' nicht gefunden: $(ENTRY)"; exit 1; }

index:
	@sed -i 's#src/apps/[^/]*/main\.ts#src/apps/$(APP)/main.ts#' index.html

dev: check index
	bun index.html

build: check index
	bun build ./index.html --outdir=dist

clean:
	rm -rf dist
