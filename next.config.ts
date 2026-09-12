import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['mjml'],
  allowedDevOrigins: ['67b7-31-175-8-5.ngrok-free.app'],
};

export default withNextIntl(config);
