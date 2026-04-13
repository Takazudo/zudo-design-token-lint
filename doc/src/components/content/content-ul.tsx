type Props = {
  children?: React.ReactNode;
  className?: string;
  [key: string]: any;
};

export function ContentUl({ children, className, ...rest }: Props) {
  return (
    <ul
      {...rest}
      className={className || undefined}
      style={{ paddingLeft: '2em', listStyleType: 'disc' }}
    >
      {children}
    </ul>
  );
}
