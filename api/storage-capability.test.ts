import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the env module before importing the capability module
vi.mock('./lib/env', () => ({
  env: {
    appSecret: 'test-secret-for-unit-tests-only'
  }
}));

import { 
  generateCapabilityClaims, 
  signCapabilityClaims, 
  verifyCapabilityToken,
  hashCapabilityToken 
} from './upload-capability';

describe('Capability Token Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate and verify valid capability token', () => {
    const claims = generateCapabilityClaims(
      'test-intent-id',
      'om',
      'doc_files',
      { folderId: 123 },
      'v1/folder-123/uuid',
      'om-manuals',
      'test-file.pdf',
      'application/pdf',
      1024
    );
    
    const token = signCapabilityClaims(claims);
    const verified = verifyCapabilityToken(token);
    
    expect(verified).not.toBeNull();
    expect(verified!.intentId).toBe('test-intent-id');
    expect(verified!.mod).toBe('om');
    expect(verified!.fn).toBe('test-file.pdf');
    expect(verified!.size).toBe(1024);
  });
  
  it('should reject tampered token', () => {
    const claims = generateCapabilityClaims('id', 'om', 'src', {}, 'path', 'bucket', 'file.pdf', 'application/pdf', 100);
    const token = signCapabilityClaims(claims);
    const tampered = token.slice(0, -5) + 'xxxxx';
    
    expect(verifyCapabilityToken(tampered)).toBeNull();
  });
  
  it('should reject expired token', () => {
    const claims = generateCapabilityClaims('id', 'om', 'src', {}, 'path', 'bucket', 'file.pdf', 'application/pdf', 100);
    claims.exp = Math.floor(Date.now() / 1000) - 1; // Expired
    const token = signCapabilityClaims(claims);
    
    expect(verifyCapabilityToken(token)).toBeNull();
  });
  
  it('should produce consistent token hashes', () => {
    const claims = generateCapabilityClaims('id', 'om', 'src', {}, 'path', 'bucket', 'file.pdf', 'application/pdf', 100);
    const token = signCapabilityClaims(claims);
    
    const hash1 = hashCapabilityToken(token);
    const hash2 = hashCapabilityToken(token);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });
  
  it('should produce different hashes for different tokens', () => {
    const claims1 = generateCapabilityClaims('id1', 'om', 'src', {}, 'path1', 'bucket', 'file1.pdf', 'application/pdf', 100);
    const claims2 = generateCapabilityClaims('id2', 'om', 'src', {}, 'path2', 'bucket', 'file2.pdf', 'application/pdf', 100);
    
    const token1 = signCapabilityClaims(claims1);
    const token2 = signCapabilityClaims(claims2);
    
    const hash1 = hashCapabilityToken(token1);
    const hash2 = hashCapabilityToken(token2);
    
    expect(hash1).not.toBe(hash2);
  });
});
