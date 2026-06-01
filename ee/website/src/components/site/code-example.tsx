'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import {
  CheckIcon,
  ChevronDown,
  ChevronUp,
  CodeIcon,
  CopyIcon,
  ExternalLink,
  GithubIcon,
  ReactLogo,
  SvelteLogo,
  VueLogo,
} from './icons';

interface CodeFile {
  filename: string;
  code: string;
  language: string;
  githubUrl?: string;
  highlightedCode?: string;
}

interface CodeExampleProps {
  children: ReactNode;
  files?: CodeFile[];
  framed?: boolean;
  background?: 'dots' | 'solid' | 'none';
  code?: string;
  language?: string;
  highlightedCode?: string;
  githubUrl?: string;
}

const backgroundStyles: Record<NonNullable<CodeExampleProps['background']>, string> = {
  dots: 'cp-dots bg-cp-bg text-[#D7E1F2]',
  solid: 'bg-cp-surface',
  none: 'bg-white',
};

function FrameworkIcon({ language }: { language: string }) {
  const lang = language.toLowerCase();
  if (lang === 'tsx' || lang === 'jsx') return <ReactLogo width={15} height={15} />;
  if (lang === 'vue') return <VueLogo width={14} height={14} />;
  if (lang === 'svelte') return <SvelteLogo width={13} height={13} />;
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="currentColor" className="text-[#5E72A8]">
      <path
        fillRule="evenodd"
        d="M4 1.75A1.75 1.75 0 0 1 5.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 14.25 16H5.75A1.75 1.75 0 0 1 4 14.25V1.75zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073H5.75z"
      />
    </svg>
  );
}

export function CodeExample({
  children,
  files = [],
  framed = false,
  background = 'dots',
  code,
  language = 'tsx',
  highlightedCode,
  githubUrl: legacyGithubUrl,
}: CodeExampleProps) {
  const [showCode, setShowCode] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showGithubMenu, setShowGithubMenu] = useState(false);
  const githubMenuRef = useRef<HTMLDivElement>(null);

  const allFiles: CodeFile[] =
    files.length > 0
      ? files
      : code
        ? [{ filename: 'Example.tsx', code, language, highlightedCode, githubUrl: legacyGithubUrl }]
        : [];

  const activeFile = allFiles[activeTab];
  const hasMultipleFiles = allFiles.length > 1;
  const totalLines = allFiles.reduce((sum, f) => sum + f.code.trim().split('\n').length, 0);
  const filesWithGithub = allFiles.filter((f) => f.githubUrl);
  const hasGithubUrls = filesWithGithub.length > 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (githubMenuRef.current && !githubMenuRef.current.contains(event.target as Node)) {
        setShowGithubMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function copyToClipboard() {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.code.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="not-prose border-cp-border my-8 overflow-hidden rounded-[16px] border bg-white shadow-[0_1px_2px_rgba(10,26,77,0.04),0_18px_40px_-30px_rgba(10,26,77,0.2)]">
      {/* Live preview */}
      <div className={`relative overflow-hidden p-4 sm:p-8 ${backgroundStyles[background]}`}>
        <div
          className={`relative w-full ${
            framed
              ? 'border-cp-border overflow-hidden rounded-xl border bg-white shadow-[0_1px_2px_rgba(10,26,77,0.05)]'
              : ''
          }`}
        >
          {children}
        </div>
      </div>

      {/* Toolbar */}
      <div
        className={`border-cp-border bg-cp-surface relative z-10 flex items-center justify-between border-t px-3 py-2 ${
          showCode ? '' : 'rounded-b-[16px]'
        }`}
      >
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="text-cp-navy -ml-1.5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-sans text-[13px] font-semibold transition-colors hover:bg-[#DCE8FE]"
        >
          <CodeIcon width={14} height={14} className="text-cp-blue" />
          <span>{showCode ? 'Hide code' : 'View code'}</span>
          {showCode ? (
            <ChevronUp width={14} height={14} className="ml-0.5" />
          ) : (
            <ChevronDown width={14} height={14} className="ml-0.5" />
          )}
          {!showCode && (
            <span className="text-cp-muted ml-1.5 hidden font-mono text-[12px] font-medium sm:inline">
              {totalLines} lines{hasMultipleFiles && ` \u00b7 ${allFiles.length} files`}
            </span>
          )}
        </button>

        <div className="flex items-center gap-0.5">
          {showCode && (
            <button
              type="button"
              onClick={copyToClipboard}
              title="Copy code"
              className="text-cp-muted hover:text-cp-navy inline-flex items-center rounded-md p-2 transition-colors hover:bg-[#DCE8FE]"
            >
              {copied ? (
                <CheckIcon width={15} height={15} className="text-[#1F9D5B]" strokeWidth={2.6} />
              ) : (
                <CopyIcon width={15} height={15} />
              )}
            </button>
          )}

          {hasGithubUrls && (
            <div className="relative" ref={githubMenuRef}>
              {filesWithGithub.length === 1 ? (
                <a
                  href={filesWithGithub[0].githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on GitHub"
                  className="text-cp-muted hover:text-cp-navy inline-flex items-center gap-1.5 rounded-md p-2 transition-colors hover:bg-[#DCE8FE]"
                >
                  <GithubIcon width={15} height={15} />
                  <ExternalLink width={11} height={11} className="opacity-50" />
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowGithubMenu((v) => !v)}
                    title="View on GitHub"
                    className={`inline-flex items-center gap-1 rounded-md p-2 transition-colors ${
                      showGithubMenu
                        ? 'text-cp-navy bg-[#DCE8FE]'
                        : 'text-cp-muted hover:text-cp-navy hover:bg-[#DCE8FE]'
                    }`}
                  >
                    <GithubIcon width={15} height={15} />
                    <ChevronDown
                      width={12}
                      height={12}
                      className={`transition-transform ${showGithubMenu ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {showGithubMenu && (
                    <div className="border-cp-border absolute right-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-lg border bg-white shadow-[0_20px_60px_rgba(7,32,76,0.25)]">
                      <div className="border-cp-borderSoft font-display text-cp-muted border-b px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em]">
                        View on GitHub
                      </div>
                      {filesWithGithub.map((file) => (
                        <a
                          key={file.filename}
                          href={file.githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setShowGithubMenu(false)}
                          className="text-cp-ink hover:bg-cp-surface flex items-center gap-2.5 px-3 py-2.5 font-sans text-[13px] transition-colors"
                        >
                          <FrameworkIcon language={file.language} />
                          <span className="flex-1 truncate">{file.filename}</span>
                          <ExternalLink
                            width={12}
                            height={12}
                            className="text-cp-muted flex-shrink-0"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Code panel */}
      {showCode && activeFile && (
        <div className="overflow-hidden rounded-b-[16px] bg-[#0E1A40]">
          {hasMultipleFiles ? (
            <div className="flex overflow-x-auto border-t border-[#1E2C5A] bg-[#0A1638]">
              {allFiles.map((file, index) => (
                <button
                  key={file.filename}
                  type="button"
                  onClick={() => setActiveTab(index)}
                  className={`relative flex items-center gap-2 whitespace-nowrap px-4 py-2.5 font-sans text-[12.5px] font-semibold transition-colors ${
                    activeTab === index
                      ? 'bg-[#0E1A40] text-white'
                      : 'text-[#8FA5D9] hover:bg-white/5 hover:text-[#C7DEFF]'
                  }`}
                >
                  {activeTab === index && (
                    <span className="bg-cp-blue absolute inset-x-0 -bottom-px h-0.5 rounded-full" />
                  )}
                  <FrameworkIcon language={file.language} />
                  {file.filename}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between border-t border-[#1E2C5A] bg-[#0A1638] px-4 py-2.5">
              <span className="flex items-center gap-2 font-mono text-[12.5px] font-semibold text-[#8FA5D9]">
                <FrameworkIcon language={activeFile.language} />
                {activeFile.filename}
              </span>
              <span className="font-mono text-[12px] text-[#5E72A8]">
                {activeFile.code.trim().split('\n').length} lines
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            {activeFile.highlightedCode ? (
              <pre className="cp-code-pre px-[18px] py-4 font-mono text-[13px] leading-[1.8] text-[#C8D3EA]">
                <code dir="ltr" dangerouslySetInnerHTML={{ __html: activeFile.highlightedCode }} />
              </pre>
            ) : (
              <pre className="px-[18px] py-4 font-mono text-[13px] leading-[1.8] text-[#C8D3EA]">
                <code>{activeFile.code.trim()}</code>
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CodeExample;
