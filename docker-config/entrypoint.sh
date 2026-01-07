#!/bin/bash

# pm2 or any start scripts
npm run prod-start

# never sleep
tail -f /dev/null