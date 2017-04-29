#!/bin/bash
set -e
if [ -z ${1+x} ]; then echo "version argument not given, please state M.m.p"; exit 1; fi
VERSION=v${1}
echo "Updating master to ${VERSION}"
git remote update origin
git remote update github
git checkout master
git pull github ${VERSION}
git push origin master
git checkout rxjs
git pull origin rxjs
# This Likely to fail
git rebase -i master
./resources/pullNRebaseFinish.sh ${1}
