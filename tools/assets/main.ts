import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../../src/data';
import type { UnitClass } from '../../src/data/types';
import type { SpriteAsset } from '../../src/shared/assetManifest';
import { AtlasBuilder } from './atlas';
import type { AtlasStats } from './atlas';
import { buildBuildingAtlas } from './buildings';
import {
  arrowImage,
  artifactImages,
  boltImage,
  bushImages,
  fishImages,
  goldImages,
  ruinImages,
  stoneImage,
  stoneImages,
  terrainFrames,
  treeImages,
} from './nature';
import { buildUnitAtlas, renderUnitPose, unitSpecs } from './units';

const GENERATED_DIRECTORIES = ['units', 'buildings', 'nature', 'terrain', 'projectiles'];
const STONE_CLASSES: UnitClass[] = ['stone_thrower_line', 'catapult_ship'];
const BOLT_CLASSES: UnitClass[] = ['ballista_line'];
const BOLT_BUILDINGS = ['ballista_tower'];
const CARCASSES = ['gazelle', 'elephant', 'lion', 'alligator'];

function outputRoot(): string {
  const index = process.argv.indexOf('--out');
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : join(process.cwd(), 'public', 'assets');
}

function main(): void {
  const root = outputRoot();
  const data = loadGameData();
  const sprites: Record<string, SpriteAsset> = {};
  const stats: AtlasStats[] = [];
  mkdirSync(root, { recursive: true });
  for (const directory of GENERATED_DIRECTORIES) {
    rmSync(join(root, directory), { recursive: true, force: true });
  }

  const specs = unitSpecs();
  for (const spec of specs) {
    if (!data.units[spec.id]) {
      continue;
    }
    const atlas = buildUnitAtlas(spec);
    stats.push(atlas.write(root));
    sprites[spec.id] = spec.aliases
      ? { atlas: `${atlas.name}.json`, animations: spec.aliases }
      : { atlas: `${atlas.name}.json` };
  }

  for (const def of Object.values(data.buildings)) {
    const built = buildBuildingAtlas({ id: def.id, size: def.size, age: def.age, classes: def.class });
    stats.push(built.atlas.write(root));
    for (const sprite of built.sprites) {
      sprites[sprite.key] = { atlas: `${built.atlas.name}.json`, animations: sprite.aliases };
    }
  }

  const nature = new AtlasBuilder('nature/nature');
  nature.addAnimation('tree', treeImages());
  nature.addAnimation('berry_bush', bushImages());
  nature.addAnimation('gold_mine', goldImages());
  nature.addAnimation('stone_mine', stoneImages());
  nature.addAnimation('shore_fish', fishImages(false));
  nature.addAnimation('deep_fish', fishImages(true));
  nature.addAnimation('ruin', ruinImages(), 3);
  nature.addAnimation('artifact', artifactImages(), 3);
  const natureIds = ['tree', 'berry_bush', 'gold_mine', 'stone_mine', 'shore_fish', 'deep_fish', 'ruin', 'artifact'];
  for (const animal of CARCASSES) {
    const spec = specs.find((candidate) => candidate.id === animal);
    if (spec) {
      nature.addAnimation(`${animal}_carcass`, [renderUnitPose(spec, 'die', 1, 0)]);
      natureIds.push(`${animal}_carcass`);
    }
  }
  stats.push(nature.write(root));
  for (const id of natureIds) {
    sprites[id] = { atlas: 'nature/nature.json', animations: { idle: id } };
  }

  const projectiles = new AtlasBuilder('projectiles/projectiles');
  projectiles.addAnimation('arrow', [arrowImage()]);
  projectiles.addAnimation('stone', [stoneImage()]);
  projectiles.addAnimation('bolt', [boltImage()]);
  stats.push(projectiles.write(root));
  const projectileAtlas = 'projectiles/projectiles.json';
  sprites.projectile = { atlas: projectileAtlas, animations: { idle: 'arrow' } };
  for (const unit of Object.values(data.units)) {
    if (STONE_CLASSES.some((tag) => unit.class.includes(tag))) {
      sprites[`projectile.${unit.id}`] = { atlas: projectileAtlas, animations: { idle: 'stone' } };
    } else if (BOLT_CLASSES.some((tag) => unit.class.includes(tag))) {
      sprites[`projectile.${unit.id}`] = { atlas: projectileAtlas, animations: { idle: 'bolt' } };
    }
  }
  for (const id of BOLT_BUILDINGS) {
    sprites[`projectile.${id}`] = { atlas: projectileAtlas, animations: { idle: 'bolt' } };
  }

  const terrain = new AtlasBuilder('terrain/terrain', '');
  for (const [name, frame] of Object.entries(terrainFrames())) {
    terrain.addFrame(name, frame);
  }
  stats.push(terrain.write(root));
  sprites.terrain = { atlas: 'terrain/terrain.json' };

  const manifestPath = join(root, 'manifest.json');
  const previous = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { sounds?: unknown; music?: unknown })
    : {};
  const manifest = {
    version: 1,
    sprites,
    sounds: previous.sounds ?? {},
    music: previous.music ?? [],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let bytes = 0;
  let texels = 0;
  for (const entry of stats) {
    bytes += entry.bytes;
    texels += entry.width * entry.height;
    console.log(`${entry.file} ${entry.width}x${entry.height} frames=${entry.frames} png=${entry.bytes}`);
  }
  console.log(
    `atlases=${stats.length} sprites=${Object.keys(sprites).length} png=${(bytes / 1048576).toFixed(1)}MB gpu=${((texels * 4) / 1048576).toFixed(0)}MB`,
  );
}

main();
