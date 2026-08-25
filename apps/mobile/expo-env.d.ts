/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_HUB_URL?: string;
    EXPO_PUBLIC_ALLOW_LOCAL_HUB?: string;
  }
}
