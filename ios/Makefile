.PHONY: generate build test clean

generate:
	xcodegen generate

build: generate
	xcodebuild -project OpenMatch.xcodeproj \
		-scheme OpenMatch \
		-destination 'platform=iOS Simulator,name=iPhone 15,OS=latest' \
		-quiet build

test: generate
	xcodebuild -project OpenMatch.xcodeproj \
		-scheme OpenMatch \
		-destination 'platform=iOS Simulator,name=iPhone 15,OS=latest' \
		-quiet test

clean:
	rm -rf OpenMatch.xcodeproj build DerivedData
