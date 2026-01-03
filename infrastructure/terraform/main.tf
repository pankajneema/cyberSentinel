terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.20"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "cybersentinel-vpc"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "cybersentinel-igw"
  }
}

# Public Subnets
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name = "cybersentinel-public-${count.index + 1}"
  }
}

# Private Subnets
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 2)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "cybersentinel-private-${count.index + 1}"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# EKS Cluster (placeholder - requires additional setup)
# resource "aws_eks_cluster" "main" {
#   name     = "cybersentinel-cluster"
#   role_arn = aws_iam_role.eks_cluster.arn
#   ...
# }

# RDS PostgreSQL
resource "aws_db_instance" "postgres" {
  identifier     = "cybersentinel-postgres"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = var.db_instance_class
  allocated_storage = 20

  db_name  = "cybersentinel"
  username = var.db_username
  password = var.db_password

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name

  backup_retention_period = 7
  skip_final_snapshot     = true

  tags = {
    Name = "cybersentinel-postgres"
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "cybersentinel-db-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "cybersentinel-db-subnet"
  }
}

resource "aws_security_group" "rds" {
  name        = "cybersentinel-rds-sg"
  description = "Security group for RDS"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "cybersentinel-rds-sg"
  }
}

