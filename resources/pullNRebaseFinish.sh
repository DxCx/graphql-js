#!/bin/bash
set -e
if [ -z ${1+x} ]; then echo "version argument not given, please state M.m.p"; exit 1; fi
VERSION=v${1}
BRANCH_NAME=`git symbolic-ref HEAD 2>/dev/null`
BRANCH_NAME=${BRANCH_NAME##refs/heads/}
if [ "${BRANCH_NAME}" != "rxjs" ]; then echo "should be in rxjs branch"; exit 1; fi
rm -Rf node_modules/
npm install
npm test
git push origin -f rxjs
git checkout -b rxjs-${VERSION}
git push -u origin rxjs-${VERSION}
