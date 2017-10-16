build build-dist build-chocolatey build-win-installer test-only check-lockfile watch lint release-branch:
	@npm run $(@)

convert-opam-packages:
	@$(MAKE) -C opam-packages-conversion/ convert || true # some conversions fail now
	@rm -rf opam-packages/
	@mv opam-packages-conversion/output opam-packages

prepare-release: build

check-version:
ifndef VERSION
	$(error VERSION is undefined. Usage: make beta-release VERSION=0.0.1)
endif

# Beta releases to Github
# - We *don't* rewriteDependencies
# - We *don't* push a copy of node_modules
# - We *do* require all source files be preprocessed by babel and put into lib/
beta-release: check-version convert-opam-packages build
	@# Program "fails" if unstaged changes.
	@echo "Preparing beta release beta-$(VERSION)"
	@echo "--------------------------------------"
	@echo "- Will convert opam package meta-data to package.json"
	@echo "- Will locally commit built version of esy itself, along with these opam package.json conversions."
	@echo "- Will tag that commit as beta-$(VERSION)."
	@echo "- To finalize, you must follow final instructions to push that commit and tag to upstream repo."
	@echo "--------------------------------------"
	@git diff --exit-code || (echo "You have unstaged changes. Please clean up first." && exit 1)
	@git diff --cached --exit-code || (echo "You have staged changes. Please reset them or commit them first." && exit 1)
	@git rm ./.gitmodules
	@git rm -r ./opam-packages-conversion
	@git add -f lib/*
	@git add -f opam-packages/*
	@git add -f lib-legacy/*
	@git commit -m "Preparing beta release beta-v$(VERSION)"
	@# Return code is inverted to receive boolean return value
	@(git tag --delete beta-v$(VERSION) &> /dev/null)|| echo "Tag beta-v$(VERSION) doesn't yet exist, creating it now."
	@git tag -a beta-v$(VERSION) -m "beta-v$(VERSION)"
	@echo "----------------------------------------------------"
	@echo '!!!Almost Done. Complete the following two steps!!!'
	@echo "----------------------------------------------------"
	@echo '1. git show HEAD'
	@echo "  - Make sure you approve of what will be pushed to tag beta-v$(VERSION)"
	@echo "2. Push to a new branch (if you like):"
	@echo "     git push origin HEAD:branch-beta-v$(VERSION)"
	@echo "3. Push the individual tag (mandatory):"
	@echo "     git push origin beta-v$(VERSION)"
	@echo "4. Switch back to another branch (git checkout -b ANOTHERBRANCH origin/master)"
	@echo ""
	@echo "> Note: If you are pushing an update to an existing tag, you might need to add -f to the push command."

release: convert-opam-packages build
	@rm -rf .tmp
	@mkdir .tmp
	@mv node_modules/ .tmp/node_modules
	@npm install --production --ignore-scripts
	@mv node_modules lib/node_modules;
	@cp package.json .tmp/package.json
	@node ./scripts/rewriteDependencies.js
	@npm publish --access public
	@cp .tmp/package.json package.json
	@mv .tmp/node_modules node_modules
	@rm -rf lib

# Once you've ran convert-opam-packages, if you change the JS code, rerun make build
# and then you can use ~/path/to/esy/bin/esy as the binary.
