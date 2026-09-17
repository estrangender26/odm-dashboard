/**
 * Programs Engineering shared brand components.
 *
 * One import surface for the suite identity so modules stay consistent:
 *
 *   import { ModuleMasthead, SuiteMasthead, MODULE_IDENTITY } from "@/components/programs";
 */
export { default as PeIconOrb } from "./PeIconOrb";
export type { PeOrbTone, PeOrbSize } from "./PeIconOrb";
export { default as PeWordmark, PE_TAGLINE } from "./PeWordmark";
export { default as PeHeroGeometry } from "./PeHeroGeometry";
export { default as SuiteMasthead } from "./SuiteMasthead";
export { default as ModuleMasthead } from "./ModuleMasthead";
export { default as PeModuleCard } from "./PeModuleCard";
export { MODULE_IDENTITY, PE_VERBS } from "./moduleIdentity";
export type { ModuleIdentity, ModuleKey } from "./moduleIdentity";
