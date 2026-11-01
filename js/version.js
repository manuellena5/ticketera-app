// Versión de la app. Lo usan la página y el service worker (importScripts),
// así APP_VERSION y CACHE_NAME siempre suben juntos: cambiar SOLO acá.
self.APP_VERSION = '1';
self.CACHE_NAME = 'entradas-v' + self.APP_VERSION;
