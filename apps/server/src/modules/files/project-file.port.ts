export const PROJECT_FILE_PORT = Symbol('PROJECT_FILE_PORT');

export interface ProjectFileEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface ProjectFileStat {
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime: Date;
}

export interface ProjectFilePort {
  read(filePath: string): Promise<string>;
  list(directoryPath: string): Promise<ProjectFileEntry[]>;
  stat(filePath: string): Promise<ProjectFileStat>;
  exists(filePath: string): Promise<boolean>;
}
