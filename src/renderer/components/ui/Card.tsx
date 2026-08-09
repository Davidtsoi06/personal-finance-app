import './Card.css';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({ title, children, className = '', style }: CardProps) {
  return (
    <div className={`card ${className}`} style={style}>
      {title && <h3 className="card-title">{title}</h3>}
      {children}
    </div>
  );
}
