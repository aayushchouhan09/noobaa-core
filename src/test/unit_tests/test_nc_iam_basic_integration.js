/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-statements */
'use strict';

const path = require('path');
const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const { TMP_PATH, generate_nsfs_account, get_new_buckets_path_by_test_env, generate_iam_client,
         get_coretest_path } = require('../system_tests/test_utils');
const { ListUsersCommand, CreateUserCommand, GetUserCommand, UpdateUserCommand, DeleteUserCommand,
        ListAccessKeysCommand, CreateAccessKeyCommand, GetAccessKeyLastUsedCommand,
        UpdateAccessKeyCommand, DeleteAccessKeyCommand } = require('@aws-sdk/client-iam');
const { ACCESS_KEY_STATUS_ENUM } = require('../../endpoint/iam/iam_constants');

const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const setup_options = { should_run_iam: true, https_port_iam: 7005, debug: 5 };
coretest.setup(setup_options);
const { rpc_client, EMAIL, get_current_setup_options, stop_nsfs_process, start_nsfs_process } = coretest;

const CORETEST_ENDPOINT_IAM = coretest.get_iam_https_address();

const config_root = path.join(TMP_PATH, 'test_nc_iam');
// on NC - new_buckets_path is full absolute path
// on Containerized - new_buckets_path is the directory
const new_bucket_path_param = get_new_buckets_path_by_test_env(config_root, '/');

let iam_account;

mocha.describe('IAM basic integration tests - happy path', async function() {
    this.timeout(50000); // eslint-disable-line no-invalid-this

    mocha.before(async () => {
        // we want to make sure that we run this test with a couple of forks (by default setup it is 0)
        const current_setup_options = get_current_setup_options();
        const same_setup = _.isEqual(current_setup_options, setup_options);
        if (!same_setup) {
            console.log('current_setup_options', current_setup_options, 'same_setup', same_setup);
            await stop_nsfs_process();
            await start_nsfs_process(setup_options);
        }

        // needed details for creating the account (and then the client)
        await fs_utils.create_fresh_path(new_bucket_path_param);
        await fs_utils.file_must_exist(new_bucket_path_param);
        const res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { admin: true });
        iam_account = generate_iam_client(res.access_key, res.secret_key, CORETEST_ENDPOINT_IAM);
    });

    mocha.after(async () => {
        fs_utils.folder_delete(`${config_root}`);
    });

    mocha.describe('IAM User API', async function() {
        const username = 'Asahi';
        const new_username = 'Botan';

        mocha.it('list users - should be empty', async function() {
            const input = {};
            const command = new ListUsersCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
            assert.equal(response.Users.length, 0);
        });

        mocha.it('create a user', async function() {
            const input = {
                UserName: username
            };
            const command = new CreateUserCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
            assert.equal(response.User.UserName, username);

            // verify it using list users
            const input2 = {};
            const command2 = new ListUsersCommand(input2);
            const response2 = await iam_account.send(command2);
            assert.equal(response2.$metadata.httpStatusCode, 200);
            assert.equal(response2.Users.length, 1);
            assert.equal(response2.Users[0].UserName, username);
        });

        mocha.it('get a user', async function() {
            const input = {
                UserName: username
            };
            const command = new GetUserCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
            assert.equal(response.User.UserName, username);
        });

        mocha.it('update a user', async function() {
            const input = {
                NewUserName: new_username,
                UserName: username
            };
            const command = new UpdateUserCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);

            // verify it using list users
            const input2 = {};
            const command2 = new ListUsersCommand(input2);
            const response2 = await iam_account.send(command2);
            _check_status_code_ok(response2);
            assert.equal(response2.Users.length, 1);
            assert.equal(response2.Users[0].UserName, new_username);
        });

        mocha.it('delete a user', async function() {
            const input = {
                UserName: new_username // delete a user after its username was updated
            };
            const command = new DeleteUserCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
        });
    });

    mocha.describe('IAM Access Key API', async function() {
        const username2 = 'Fuji';
        let access_key_id;

        mocha.before(async () => {
            // create a user
            const input = {
                UserName: username2
            };
            const command = new CreateUserCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
        });

        mocha.after(async () => {
            // delete a user
            const input = {
                UserName: username2
            };
            const command = new DeleteUserCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
            // note: if somehow the delete access key would fail, then deleting the user would also fail
            // (as we can delete a user only after its access keys were deleted)
        });

        mocha.it('list access keys - should be empty', async function() {
            const input = {
                UserName: username2
            };
            const command = new ListAccessKeysCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
            assert.equal(response.AccessKeyMetadata.length, 0);
        });

        mocha.it('create access keys', async function() {
            const input = {
                UserName: username2
            };
            const command = new CreateAccessKeyCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
            assert.equal(response.AccessKey.UserName, username2);
            assert(response.AccessKey.AccessKeyId !== undefined);
            access_key_id = response.AccessKey.AccessKeyId;
            assert(response.AccessKey.SecretAccessKey !== undefined);
            assert.equal(response.AccessKey.Status, ACCESS_KEY_STATUS_ENUM.ACTIVE);

            // verify it using list access keys
            const input2 = {
                UserName: username2
            };
            const command2 = new ListAccessKeysCommand(input2);
            const response2 = await iam_account.send(command2);
            _check_status_code_ok(response2);
            assert.equal(response2.AccessKeyMetadata.length, 1);
            assert.equal(response2.AccessKeyMetadata[0].UserName, username2);
            assert.equal(response2.AccessKeyMetadata[0].AccessKeyId, access_key_id);
            assert.equal(response2.AccessKeyMetadata[0].Status, ACCESS_KEY_STATUS_ENUM.ACTIVE);
        });

        mocha.it('get access key (last used)', async function() {
            const input = {
                AccessKeyId: access_key_id
            };
            const command = new GetAccessKeyLastUsedCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
            assert.equal(response.UserName, username2);
            assert(response.AccessKeyLastUsed.LastUsedDate !== undefined);
            assert(response.AccessKeyLastUsed.ServiceName !== undefined);
            assert(response.AccessKeyLastUsed.Region !== undefined);
        });

        mocha.it('update access keys (active to inactive)', async function() {
            const input = {
                UserName: username2,
                AccessKeyId: access_key_id,
                Status: ACCESS_KEY_STATUS_ENUM.INACTIVE
            };
            const command = new UpdateAccessKeyCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);

            // verify it using list access keys
            const input2 = {
                UserName: username2
            };
            const command2 = new ListAccessKeysCommand(input2);
            const response2 = await iam_account.send(command2);
            _check_status_code_ok(response2);
            assert.equal(response2.AccessKeyMetadata.length, 1);
            assert.equal(response2.AccessKeyMetadata[0].UserName, username2);
            assert.equal(response2.AccessKeyMetadata[0].AccessKeyId, access_key_id);
            assert.equal(response2.AccessKeyMetadata[0].Status, ACCESS_KEY_STATUS_ENUM.INACTIVE);
        });

        mocha.it('delete access keys', async function() {
            const input = {
                UserName: username2,
                AccessKeyId: access_key_id
            };
            const command = new DeleteAccessKeyCommand(input);
            const response = await iam_account.send(command);
            _check_status_code_ok(response);
        });
    });
});

/**
 * _check_status_code_ok is an helper function to check that we got an response from the server
 * @param {{ $metadata: { httpStatusCode: number; }; }} response
 */
function _check_status_code_ok(response) {
    assert.equal(response.$metadata.httpStatusCode, 200);
}
