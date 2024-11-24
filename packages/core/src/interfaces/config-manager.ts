/**
 * Available configuration sources
 */
export const CONFIG_SOURCES = ['env', 'db'] as const;
export type ConfigSource = typeof CONFIG_SOURCES[number];

/**
 * Metadata for a configuration value
 */
export interface ConfigDefinition<T> {
  defaultValue: T;
  envVarName?: string;
  isSecret?: boolean;
}

/**
 * Helper function for defining configurations with type safety
 */
export const defineConfig = <T>(config: ConfigDefinition<T>): ConfigDefinition<T> => config;

/**
 * Interface for loading configuration values
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IConfigLoader<K extends string, V extends Record<K, any>> {
  /**
   * Load configurations from environment variables
   */
  loadFromEnv(): Promise<RawConfigData<K, V>>;

  /**
   * Load configurations from database
   */
  loadFromDB(): Promise<RawConfigData<K, V>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawConfigData<K extends string, V extends Record<K, any>> = Record<K, {
  definition: ConfigDefinition<V[K]>;
  value: V[K];
}>;

export type UpdateConfigOptions = { skipPubsub?: boolean };

/**
 * Interface for managing configuration values
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IConfigManager<K extends string, V extends Record<K, any>> {
  /**
   * Load configurations
   * @param options.source - Specify which source to load from
   */
  loadConfigs(options?: { source?: ConfigSource }): Promise<void>;

  /**
   * Get a configuration value
   */
  getConfig<T extends K>(key: T): V[T];

  /**
   * Update a configuration value
   */
  updateConfig<T extends K>(key: T, value: V[T], options?: UpdateConfigOptions): Promise<void>;

  /**
   * Update multiple configuration values
   */
  updateConfigs(updates: Partial<{ [T in K]: V[T] }>, options?: UpdateConfigOptions): Promise<void>;

  /**
   * Remove multiple configuration values
   */
  removeConfigs(keys: K[], options?: UpdateConfigOptions): Promise<void>;

  /**
   * Get raw configuration data for UI display
   */
  getRawConfigData(): {
    env: RawConfigData<K, V[K]>;
    db: RawConfigData<K, V[K]>;
  };

  /**
   * Get environment variables managed with ConfigDefinitions
   */
  getManagedEnvVars(includeSecret: boolean): Record<string, string>;

}
