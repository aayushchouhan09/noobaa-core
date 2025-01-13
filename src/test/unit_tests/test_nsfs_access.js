/* Copyright (C) 2020 NooBaa */
'use strict';


const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const test_utils = require('../system_tests/test_utils');
const fs = require('fs');

const new_umask = process.env.NOOBAA_ENDPOINT_UMASK || 0o000;
const old_umask = process.umask(new_umask);
console.log('test_nsfs_access: replacing old umask: ', old_umask.toString(8), 'with new umask: ', new_umask.toString(8));


mocha.describe('new tests check', async function() {
    const p = '/tmp/dir/';
    const root_dir = 'root_dir';
    const non_root_dir = 'non_root_dir';
    const non_root_dir2 = 'non_root_dir2';
    const full_path_root = path.join(p, root_dir);
    const full_path_non_root = path.join(full_path_root, non_root_dir);
    const full_path_non_root1 = path.join(p, non_root_dir);
    const full_path_non_root2 = path.join(p, non_root_dir2);

    const ROOT_FS_CONFIG = {
        uid: process.getuid(),
        gid: process.getgid(),
        backend: '',
        warn_threshold_ms: 100,
    };
    const NON_ROOT1_FS_CONFIG = {
        uid: 1572,
        gid: 1572,
        backend: '',
        warn_threshold_ms: 100,
    };

    const NON_ROOT2_FS_CONFIG = {
        uid: 1573,
        gid: 1573,
        backend: '',
        warn_threshold_ms: 100,
    };

    const NON_ROOT3_FS_CONFIG = {
        uid: 1574,
        gid: 1574,
        backend: '',
        supplemental_groups: [1572, 1577], //gid of non-root1 and unrelated gid
        warn_threshold_ms: 100,
    };
    mocha.before(async function() {
        if (test_utils.invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        await fs_utils.create_fresh_path(p, 0o777);
        await fs_utils.file_must_exist(p);
        await fs_utils.create_fresh_path(full_path_root, 0o770);
        await fs_utils.file_must_exist(full_path_root);
    });

    mocha.after(async function() {
        await fs_utils.folder_delete(p);
    });

    mocha.it('ROOT readdir - sucsses', async function() {
        const root_entries = await nb_native().fs.readdir(ROOT_FS_CONFIG, full_path_root);
        assert.equal(root_entries && root_entries.length, 0);
    });
    mocha.it('NON ROOT 1 readdir - failure', async function() {
        try {
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT1_FS_CONFIG, full_path_root);
            assert.fail(`non root has access to root dir ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });
    mocha.it('NON ROOT 1 mkdir - failure', async function() {
        try {
            const mkdir_res = await nb_native().fs.mkdir(NON_ROOT1_FS_CONFIG, full_path_non_root, 0o770);
            assert.fail(`non root has access to mkdir under root dir ${mkdir_res}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });
    mocha.it('ROOT readdir - dir created by non dir - success', async function() {
        try {
            const root_entries = await nb_native().fs.readdir(ROOT_FS_CONFIG, full_path_non_root);
            assert.fail(`root has access to a folder that should not exist - ${root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
    });

    mocha.it('NON ROOT 1 readdir - success', async function() {
        try {
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT1_FS_CONFIG, full_path_non_root);
            assert.fail(`non root 1 has access to a folder created by root with 770 perm - ${p} - ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });

    mocha.it('NON ROOT 2 readdir - failure', async function() {
        try {
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT2_FS_CONFIG, full_path_non_root);
            assert.fail(`non root 2 has access to a folder created by root with 770 perm - ${p} ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });

    mocha.it('NON ROOT 3 with suplemental group - success', async function() {
        await nb_native().fs.mkdir(NON_ROOT1_FS_CONFIG, full_path_non_root1, 0o770);
        //TODO on mac new directories are created with the parents directory GID and not with the process GID. manually change the gid
        fs.promises.chown(full_path_non_root1, NON_ROOT1_FS_CONFIG.uid, NON_ROOT1_FS_CONFIG.gid);
        //non root3 has non-root1 group as supplemental group, so it should succeed
        const non_root_entries = await nb_native().fs.readdir(NON_ROOT3_FS_CONFIG, full_path_non_root1);
        assert.equal(non_root_entries && non_root_entries.length, 0);
    });

    mocha.it('NON ROOT 3 suplemental group without the files gid - failure', async function() {
        await nb_native().fs.mkdir(NON_ROOT2_FS_CONFIG, full_path_non_root2, 0o770);
        //TODO on mac new directories are created with the parents directory GID and not with the process GID. manually change the gid
        fs.promises.chown(full_path_non_root2, NON_ROOT2_FS_CONFIG.uid, NON_ROOT2_FS_CONFIG.gid);
        try {
            //non root3 doesn't have non-root2 group as supplemental group, so it should fail
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT3_FS_CONFIG, full_path_non_root2);
            assert.fail(`non root 3 has access to a folder created by user with gid not insupplemental groups - ${p} ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });
});



