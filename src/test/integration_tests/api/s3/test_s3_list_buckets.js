/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
/* eslint-disable no-invalid-this */

'use strict';
// setup coretest first to prepare the env
const coretest = require('../../../utils/coretest/coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const config = require('../../../../../config');
const { S3Client, ListBucketsCommand, CreateBucketCommand, DeleteBucketCommand } = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http_utils = require('../../../../util/http_utils');
const mocha = require('mocha');
const assert = require('assert');

const { rpc_client, EMAIL } = coretest;

const bucket_names = ['a.bucket1',
                        'b.bucket2',
                        'f.bucket3',
                        'c.bucket4',
                        'h.bucket5',
                        'd.bucket6',
                        'e.bucket7',
                        'g.bucket8'
                    ];

mocha.describe('s3_ops', function() {

    let s3;
    let s3_client_params;

    mocha.before(async function() {
        const self = this;
        self.timeout(60000);
        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        s3_client_params = {
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: account_info.access_keys[0].access_key.unwrap(),
                secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
            }),
        };
        s3 = new S3Client(s3_client_params);
        coretest.log('S3 CONFIG', s3.config);
    });

    mocha.after(async () => {
        let delete_bucket;
        for (const bucket of bucket_names) {
                delete_bucket = new DeleteBucketCommand({
                Bucket: bucket,
            });
            await s3.send(delete_bucket);
        }
    });

    mocha.describe('list paginated bucket op', function() {
        this.timeout(60000);
        let res;
        let create_bucket;
        mocha.it('Create 8 buckets', async function() {
            for (const bucket of bucket_names) {
                create_bucket = new CreateBucketCommand({
                    Bucket: bucket,
                });
                await s3.send(create_bucket);
            }
        });

        mocha.it('Delete first.bucket', async function() {
                const delete_bucket = new DeleteBucketCommand({
                    Bucket: "first.bucket",
                });
                await s3.send(delete_bucket);
        });

        mocha.it('List Buckets with pagination: MaxBuckets < Number of Buckets', async function() {
            let input = {
                MaxBuckets: 3
            };
            let command = new ListBucketsCommand(input);
            res = await s3.send(command);
            assert(res.Buckets.length === 3);
            assert(res.ContinuationToken !== undefined);

            input = {
                MaxBuckets: 3,
                ContinuationToken: res.ContinuationToken
            };
            command = new ListBucketsCommand(input);
            res = await s3.send(command);
            assert(res.Buckets.length === 3);
            assert(res.ContinuationToken !== undefined);

            input = {
                MaxBuckets: 3,
                ContinuationToken: res.ContinuationToken
            };
            command = new ListBucketsCommand(input);
            res = await s3.send(command);
            assert(res.Buckets.length === 2);
            assert(res.ContinuationToken === undefined);

        });

        mocha.it('List Buckets with pagination: MaxBuckets > Number of Buckets', async function() {
            const input = {
                MaxBuckets: 20
            };
            const command = new ListBucketsCommand(input);
            res = await s3.send(command);
            assert(res.Buckets.length === 8);
            assert(res.ContinuationToken === undefined);

        });

        mocha.it('List Buckets without pagination', async function() {
            const command = new ListBucketsCommand();
            res = await s3.send(command);
            assert(res.Buckets.length === 8);
        });
    });

    mocha.describe('list_buckets permissions', function() {
        this.timeout(60000);
        let s3_user;
        const test_user = 'test-user';
        const user_bucket = 'user-buck';
        const admin_bucket = 'admin-buck';

        mocha.before(async function() {
            const account = await rpc_client.account.create_account({
                name: test_user,
                email: test_user,
                has_login: false,
                s3_access: true,
                default_resource: coretest.POOL_LIST[0].name
            });

            s3_user = new S3Client({
                ...s3_client_params,
                credentials: {
                    accessKeyId: account.access_keys[0].access_key.unwrap(),
                    secretAccessKey: account.access_keys[0].secret_key.unwrap(),
                }
            });

            await s3_user.send(new CreateBucketCommand({ Bucket: user_bucket }));
            await s3.send(new CreateBucketCommand({ Bucket: admin_bucket }));
        });

        mocha.after(async function() {
            await s3_user.send(new DeleteBucketCommand({ Bucket: user_bucket }));
            await s3.send(new DeleteBucketCommand({ Bucket: admin_bucket }));
            await rpc_client.account.delete_account({ email: test_user });
        });

        mocha.it('user should list only owned buckets', async function() {
            const buckets = (await s3_user.send(new ListBucketsCommand())).Buckets.map(b => b.Name);
            assert(buckets.includes(user_bucket) && !buckets.includes(admin_bucket));
        });

        mocha.it('admin should list all buckets', async function() {
            const buckets = (await s3.send(new ListBucketsCommand())).Buckets.map(b => b.Name);
            assert(buckets.length >= 2);
            assert(buckets.includes(user_bucket));
            assert(buckets.includes(admin_bucket));
        });

        mocha.it('bucket policy grants list access', async function() {
            let buckets = (await s3_user.send(new ListBucketsCommand())).Buckets.map(b => b.Name);
            assert(!buckets.includes(admin_bucket));

            await rpc_client.bucket.put_bucket_policy({
                name: admin_bucket,
                policy: {
                    Version: '2012-10-17',
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: test_user },
                        Action: ['s3:ListBucket'],
                        Resource: [`arn:aws:s3:::${admin_bucket}`]
                    }]
                }
            });

            buckets = (await s3_user.send(new ListBucketsCommand())).Buckets.map(b => b.Name);
            assert(buckets.includes(admin_bucket));

            await rpc_client.bucket.delete_bucket_policy({ name: admin_bucket });

            buckets = (await s3_user.send(new ListBucketsCommand())).Buckets.map(b => b.Name);
            assert(!buckets.includes(admin_bucket));
        });
    });

});

