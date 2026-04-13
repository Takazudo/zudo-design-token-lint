type Props = {
  children?: React.ReactNode;
  className?: string;
  [key: string]: any;
};

export function ContentOl({ children, className, ...rest }: Props) {
  return (
    <ol
      {...rest}
      className={className || undefined}
      style={{ paddingLeft: '2em', listStyleType: 'decimal' }}
    >
      {children}
    </ol>
  );
}
