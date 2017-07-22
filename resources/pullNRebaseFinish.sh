#!/bin/bash
set -e
if [ -z ${1+x} ]; then echo "version argument not given, please state M.m.p"; exit 1; fi
VERSION=v${1}
BRANCH_NAME=`git symbolic-ref HEAD 2>/dev/null`
BRANCH_NAME=${BRANCH_NAME##refs/heads/}
if [ "${BRANCH_NAME}" != "async" ]; then echo "should be in async branch"; exit 1; fi
rm -Rf node_modules/
yarn
npm test
git push origin -f async
git checkout -b async-${VERSION}
git push -u origin async-${VERSION}
