/**
 * Build a CdnConfig from environment variables.
 *
 * Convention:
 *   EMBEDPDF_CDN_KIND=none|bunny|cloud-cdn|cloudfront|azure-fd|custom-hmac
 *      (default: none)
 *
 *   # bunny
 *   EMBEDPDF_CDN_BUNNY_ZONE_HOSTNAME=embedpdf-prod.b-cdn.net
 *   EMBEDPDF_CDN_BUNNY_ZONE_TOKEN=secret://<provider>/<name>  (or literal)
 *   EMBEDPDF_CDN_BUNNY_API_KEY=secret://...                   (optional, for purge)
 *
 *   # cloud-cdn
 *   EMBEDPDF_CDN_CLOUD_CDN_URL_PREFIX=https://cdn.example.com
 *   EMBEDPDF_CDN_CLOUD_CDN_KEY_NAME=embedpdf-key
 *   EMBEDPDF_CDN_CLOUD_CDN_KEY_VALUE=secret://...
 *   EMBEDPDF_CDN_CLOUD_CDN_PROJECT_ID=...                     (optional, for purge)
 *
 *   # cloudfront
 *   EMBEDPDF_CDN_CLOUDFRONT_DISTRIBUTION_DOMAIN=d123.cloudfront.net
 *   EMBEDPDF_CDN_CLOUDFRONT_KEY_PAIR_ID=K2JCJMDEHXQW5F
 *   EMBEDPDF_CDN_CLOUDFRONT_PRIVATE_KEY_PEM=secret://...
 *   EMBEDPDF_CDN_CLOUDFRONT_MODE=cookies|urls                 (default: cookies)
 *   EMBEDPDF_CDN_CLOUDFRONT_DISTRIBUTION_ID=E1ABCDEFGHIJK     (optional, for purge)
 *   EMBEDPDF_CDN_CLOUDFRONT_COOKIE_DOMAIN=.example.com        (optional)
 *
 *   # azure-fd
 *   EMBEDPDF_CDN_AZURE_FD_ENDPOINT=https://embedpdf.azurefd.net
 *   EMBEDPDF_CDN_AZURE_FD_SECRET=secret://...
 *   EMBEDPDF_CDN_AZURE_FD_PROFILE_NAME=...                    (optional, for purge)
 *
 *   # custom-hmac
 *   EMBEDPDF_CDN_CUSTOM_HMAC_CDN_ORIGIN=https://cdn.example.com
 *   EMBEDPDF_CDN_CUSTOM_HMAC_SECRET=secret://...
 *   EMBEDPDF_CDN_CUSTOM_HMAC_TRANSPORT=header|query           (default: header)
 *   EMBEDPDF_CDN_CUSTOM_HMAC_PURGE_WEBHOOK_URL=https://...    (optional)
 */

import type { SecretRefConfig } from '../../config/secrets/SecretRef';
import { parseSecretRefUri } from '../../config/secrets/parseSecretRefUri';
import { CdnConfigSchema, type CdnConfig } from './CdnConfigSchema';

export function loadCdnConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CdnConfig {
  const kind = (env['EMBEDPDF_CDN_KIND'] ?? 'none').toLowerCase();
  switch (kind) {
    case 'none':
      return CdnConfigSchema.parse({ kind: 'none' });
    case 'bunny': {
      const zoneHostname = req(env, 'EMBEDPDF_CDN_BUNNY_ZONE_HOSTNAME');
      const zoneToken = parseSecretOrLiteral(req(env, 'EMBEDPDF_CDN_BUNNY_ZONE_TOKEN'));
      const apiKeyRaw = env['EMBEDPDF_CDN_BUNNY_API_KEY'];
      return CdnConfigSchema.parse({
        kind: 'bunny',
        zoneHostname,
        zoneToken,
        ...(apiKeyRaw ? { apiKey: parseSecretOrLiteral(apiKeyRaw) } : {}),
      });
    }
    case 'cloud-cdn': {
      const urlPrefix = req(env, 'EMBEDPDF_CDN_CLOUD_CDN_URL_PREFIX');
      const keyName = req(env, 'EMBEDPDF_CDN_CLOUD_CDN_KEY_NAME');
      const keyValue = parseSecretOrLiteral(req(env, 'EMBEDPDF_CDN_CLOUD_CDN_KEY_VALUE'));
      const projectId = env['EMBEDPDF_CDN_CLOUD_CDN_PROJECT_ID'];
      const serviceAccountKeyRaw = env['EMBEDPDF_CDN_CLOUD_CDN_SERVICE_ACCOUNT_KEY'];
      return CdnConfigSchema.parse({
        kind: 'cloud-cdn',
        urlPrefix,
        keyName,
        keyValue,
        ...(projectId ? { projectId } : {}),
        ...(serviceAccountKeyRaw
          ? { serviceAccountKey: parseSecretOrLiteral(serviceAccountKeyRaw) }
          : {}),
      });
    }
    case 'cloudfront': {
      const distributionDomain = req(env, 'EMBEDPDF_CDN_CLOUDFRONT_DISTRIBUTION_DOMAIN');
      const keyPairId = req(env, 'EMBEDPDF_CDN_CLOUDFRONT_KEY_PAIR_ID');
      const privateKeyPem = parseSecretOrLiteral(
        req(env, 'EMBEDPDF_CDN_CLOUDFRONT_PRIVATE_KEY_PEM'),
      );
      const mode = env['EMBEDPDF_CDN_CLOUDFRONT_MODE'] ?? 'cookies';
      const distributionId = env['EMBEDPDF_CDN_CLOUDFRONT_DISTRIBUTION_ID'];
      const awsRegion = env['EMBEDPDF_CDN_CLOUDFRONT_AWS_REGION'];
      const cookieDomain = env['EMBEDPDF_CDN_CLOUDFRONT_COOKIE_DOMAIN'];
      return CdnConfigSchema.parse({
        kind: 'cloudfront',
        distributionDomain,
        keyPairId,
        privateKeyPem,
        mode,
        ...(distributionId ? { distributionId } : {}),
        ...(awsRegion ? { awsRegion } : {}),
        ...(cookieDomain ? { cookieDomain } : {}),
      });
    }
    case 'azure-fd': {
      const endpoint = req(env, 'EMBEDPDF_CDN_AZURE_FD_ENDPOINT');
      const secret = parseSecretOrLiteral(req(env, 'EMBEDPDF_CDN_AZURE_FD_SECRET'));
      const profileName = env['EMBEDPDF_CDN_AZURE_FD_PROFILE_NAME'];
      const subscriptionId = env['EMBEDPDF_CDN_AZURE_FD_SUBSCRIPTION_ID'];
      return CdnConfigSchema.parse({
        kind: 'azure-fd',
        endpoint,
        secret,
        ...(profileName ? { profileName } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
      });
    }
    case 'custom-hmac': {
      const cdnOrigin = req(env, 'EMBEDPDF_CDN_CUSTOM_HMAC_CDN_ORIGIN');
      const secret = parseSecretOrLiteral(req(env, 'EMBEDPDF_CDN_CUSTOM_HMAC_SECRET'));
      const transport = env['EMBEDPDF_CDN_CUSTOM_HMAC_TRANSPORT'] ?? 'header';
      const purgeWebhookUrl = env['EMBEDPDF_CDN_CUSTOM_HMAC_PURGE_WEBHOOK_URL'];
      return CdnConfigSchema.parse({
        kind: 'custom-hmac',
        cdnOrigin,
        secret,
        transport,
        ...(purgeWebhookUrl ? { purgeWebhookUrl } : {}),
      });
    }
    default:
      throw new Error(
        `EMBEDPDF_CDN_KIND="${kind}" is not recognized (expected none|bunny|cloud-cdn|cloudfront|azure-fd|custom-hmac)`,
      );
  }
}

/**
 * Accept either a `secret://<provider>/<name>?...` URI or a plain
 * literal string. URIs become SecretRefs; literals pass through to
 * the schema's `string` branch and are used as-is at construction.
 */
function parseSecretOrLiteral(value: string): SecretRefConfig | string {
  if (value.startsWith('secret://')) return parseSecretRefUri(value);
  return value;
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
