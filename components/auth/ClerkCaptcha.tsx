interface ClerkCaptchaProps {
  hidden?: boolean;
  className?: string;
}

export function ClerkCaptcha({
  hidden = false,
  className = "",
}: ClerkCaptchaProps) {
  const style = hidden ? { display: "none" } : undefined;

  return (
    <div
      id="clerk-captcha"
      className={className}
      style={style}
      aria-hidden={hidden}
    />
  );
}
