/* @flow */

const path = require('path');
const invariant = require('invariant');
const semver = require('semver');
const EsyOpam = require('@esy-ocaml/esy-opam');
const yaml = require('js-yaml');

import type {OpamManifest} from './index.js';
import type Config from '../../../config';
import * as fs from '../../../util/fs.js';
import * as child from '../../../util/child.js';
import {cloneOrUpdateRepository, stripVersionPrelease} from './util.js';
import {
  OPAM_REPOSITORY_OVERRIDE,
  OPAM_REPOSITORY_OVERRIDE_CHECKOUT,
  OPAM_SCOPE,
} from './config.js';

export type OpamRepositoryOverride = {
  checkoutPath: string,
  overrides: Map<string, Map<string, OpamPackageOverride>>,
};

export type OpamPackageOverride = {
  build?: Array<Array<string>>,
  install?: Array<Array<string>>,
  dependencies?: {[name: string]: string},
  peerDependencies?: {[name: string]: string},
  exportedEnv: {
    [name: string]: {val: string, scope?: 'global'},
  },
  opam: {
    url: string,
    checksum: string,
    files: Array<{name: string, content: string}>,
    patches: Array<{name: string, content: string}>,
  },
};

const MATCH_ALL_VERSIONS = 'x.x.x';

let _initializing: ?Promise<OpamRepositoryOverride> = null;

/**
 * Initialize opam overrides
 */
export function init(config: Config): Promise<OpamRepositoryOverride> {
  if (_initializing == null) {
    _initializing = initImpl(config);
  }
  return _initializing;
}

export function applyOverride(
  overrides: OpamRepositoryOverride,
  manifest: OpamManifest,
): ?OpamManifest {
  const packageOverrides = overrides.overrides.get(
    manifest.name.slice(`@${OPAM_SCOPE}/`.length),
  );

  if (packageOverrides == null) {
    return null;
  }

  for (const [versionRange, override] of packageOverrides.entries()) {
    if (semver.satisfies(stripVersionPrelease(manifest.version), versionRange)) {
      manifest = {...manifest};
      const {esy, opam} = manifest;

      manifest.esy = {
        ...esy,
        build: override.build || esy.build,
        install: override.install || esy.install,
        exportedEnv: {
          ...esy.exportedEnv,
          ...override.exportedEnv,
        },
      };
      manifest.opam = {
        ...opam,
        url: override.opam.url || opam.url,
        checksum: override.opam.checksum || opam.checksum,
        files: opam.files.concat(override.opam.files),
        patches: opam.patches.concat(override.opam.patches),
      };
      manifest.dependencies = {
        ...manifest.dependencies,
        ...override.dependencies,
      };
      manifest.peerDependencies = {
        ...manifest.peerDependencies,
        ...override.peerDependencies,
      };
    }
  }

  return manifest;
}

async function initImpl(config) {
  const checkoutPath = await cloneOverridesRepo(config);

  const overridesPath = path.join(checkoutPath, 'packages');
  const overridesPathSet = await fs.readdir(overridesPath);

  const overrides = new Map();

  await Promise.all(
    overridesPathSet.map(async spec => {
      const override = await readOverride(path.join(overridesPath, spec));
      if (override == null) {
        return;
      }
      const {packageName, versionRange} = parseOverrideSpec(spec);
      const packageOverrides = mapSetDefault(overrides, packageName, mkMap);
      packageOverrides.set(versionRange, override);
    }),
  );

  return {checkoutPath, overrides};
}

function parseOverrideSpec(spec: string) {
  const idx = spec.indexOf('.');
  if (idx === -1) {
    return {packageName: spec, versionRange: MATCH_ALL_VERSIONS};
  } else {
    const packageName = spec.substring(0, idx);
    const versionRange = spec.substring(idx + 1).replace(/_/g, ' ');
    return {packageName, versionRange};
  }
}

async function readOverride(root: string): ?Promise<?OpamPackageOverride> {
  const yamlPath = path.join(root, 'package.yaml');
  const jsonPath = path.join(root, 'package.json');
  if (await fs.exists(yamlPath)) {
    const data = await fs.readFile(yamlPath);
    const override = yaml.safeLoad(data, {filename: yamlPath});
    normalizeOverride(override);
    return override;
  } else if (await fs.exists(jsonPath)) {
    const data = await fs.readFile(jsonPath);
    const override = JSON.parse(data);
    normalizeOverride(override);
    return override;
  } else {
    return null;
  }
}

function normalizeOverride(override) {
  override.exportedEnv = override.exportedEnv || {};
  override.opam = override.opam || {};
  override.opam.files = override.opam.files || [];
  override.opam.patches = override.opam.patches || [];
}

const mkMap = () => new Map();

function mapSetDefault(map, k, mkDefault) {
  const existingItem = map.get(k);
  if (existingItem !== undefined) {
    return existingItem;
  } else {
    const newItem = mkDefault();
    map.set(k, newItem);
    return newItem;
  }
}

async function cloneOverridesRepo(config) {
  if (OPAM_REPOSITORY_OVERRIDE_CHECKOUT != null) {
    return OPAM_REPOSITORY_OVERRIDE_CHECKOUT;
  }
  const checkoutPath = path.join(config.cacheFolder, 'esy-opam-override');
  const onClone = () => {
    config.reporter.info('Fetching OPAM repository overrides...');
  };
  const onUpdate = () => {
    config.reporter.info('Updating OPAM repository overrides...');
  };
  await cloneOrUpdateRepository(OPAM_REPOSITORY_OVERRIDE, checkoutPath, {
    onClone,
    onUpdate,
    branch: String(config.esyMetadataVersion || '4'),
    forceUpdate: false,
    offline: config.offline,
    preferOffline: config.preferOffline,
  });
  return checkoutPath;
}
