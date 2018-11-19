create database miranode;
use miranode;

CREATE TABLE ecckeys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pub CHAR(66),
    secret CHAR(64),
    contract CHAR(64) DEFAULT NULL,
    opened boolean default false,
    INDEX(opened));

CREATE TABLE buffer (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pub CHAR(66),
    secret CHAR(64),
    contract CHAR(64) DEFAULT NULL
);