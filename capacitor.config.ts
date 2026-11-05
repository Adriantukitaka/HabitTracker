import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.constancia.app',
  appName: 'Constancia',
  webDir: 'dist',
  backgroundColor: '#F6F6F3',
  android: {
    backgroundColor: '#F6F6F3',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'LIGHT',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_constancia',
      iconColor: '#1F883D',
    },
  },
};

export default config;
