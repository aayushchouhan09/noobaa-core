#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

function cleanup() {
    local rc
    if [ -z ${1} ]
    then
        rc=0
    else
        rc=$1
    fi
    echo "$(date) return code was: ${rc}"
    exit ${rc}
}

PATH=$PATH:/noobaa-core/node_modules/.bin

command="npm test"

function usage() {
    echo -e "Usage:\n\t${0} [options]"
    echo -e "\t-c|--command     -   Replace the unit test command (default: ${command})"
    echo -e "\t-s|--single      -   Get the desired unit test to run and running it,"
    echo -e "\t                     needs to get the relative path from the tests directory for example integration_tests/internal/test_object_io.js"
    exit 0
}

while true
do
    if [ -z ${1} ]
    then
        break
    fi

    case ${1} in
        -c|--command)   shift 1
                        command=${*}
                        command_array=(${command})
                        shift ${#command_array[@]};;
        -s|--single)    command="./node_modules/mocha/bin/mocha.js src/test/${2}"
                        shift 2;;
        *)              usage;;
    esac
done

trap cleanup 1 2

echo "$(date) running ${command}"
${command}
cleanup ${?}
