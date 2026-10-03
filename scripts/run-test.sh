#!/usr/bin/env bash
exec npx mocha -r ts-node/register --timeout 1000000 'tests/**/*.ts' "$@"
