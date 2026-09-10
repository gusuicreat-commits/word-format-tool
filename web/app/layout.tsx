import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "论格 · Word 论文格式修改器",
  description: "本地上传 Word 文档并调用 Python 工具自动修改论文格式",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
