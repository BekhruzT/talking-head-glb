#!/bin/bash
set -ex

if [ -f ".env" ]; 
then
    export $(cat .env | xargs)
fi

dir="$(pwd)"

cd "$dir" && npm install && npm run dev -w frontend