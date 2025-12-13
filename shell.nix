{ pkgs ? import <nixpkgs> {} }: pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    nodejs_latest
    pnpm
    typescript-go
    esbuild
  ];
}
