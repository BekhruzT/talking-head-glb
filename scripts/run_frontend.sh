#!/bin/bash
set -ex

if [ -f ".env" ]; 
then
    export $(cat .env | xargs)
fi

dir="$(pwd)"

cd "$dir/frontend" && npm install && npm run start